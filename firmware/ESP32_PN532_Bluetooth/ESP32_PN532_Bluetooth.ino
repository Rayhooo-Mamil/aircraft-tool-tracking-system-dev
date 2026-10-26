/*
  Simple, reliable ESP32 + PN532 + Bluetooth scanner.
  Buzzer feedback only: boot, scan success, scan failure.
*/
#include <BluetoothSerial.h>
#include <SPI.h>
#include <Adafruit_PN532.h>
#include <esp_arduino_version.h>

constexpr uint8_t PN532_SCK = 18, PN532_MISO = 19, PN532_MOSI = 23, PN532_SS = 5;
constexpr uint8_t RED_LED = 25, BLUE_LED = 26, BUZZER = 27, BUZZER_CHANNEL = 0;
constexpr char BT_NAME[] = "ToolTracker-ESP32";
constexpr unsigned long HEARTBEAT_MS = 10000, DUPLICATE_MS = 2000, ACK_TIMEOUT_MS = 10000;

BluetoothSerial SerialBT;
Adafruit_PN532 nfc(PN532_SS);
bool pn532Ready = false, waitingForAck = false, wasBluetoothConnected = false;
String lastUid, pendingUid, incomingLine;
unsigned long lastUidAt = 0, lastHeartbeatAt = 0, ackDeadline = 0, redErrorUntil = 0;

void buzzerSetup() {
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcAttach(BUZZER, 2000, 8);
  ledcWriteTone(BUZZER, 0);
  ledcWrite(BUZZER, 0);
#else
  ledcSetup(BUZZER_CHANNEL, 2000, 8);
  ledcAttachPin(BUZZER, BUZZER_CHANNEL);
  ledcWriteTone(BUZZER_CHANNEL, 0);
  ledcWrite(BUZZER_CHANNEL, 0);
#endif
}

void beep(uint16_t frequency, uint16_t durationMs) {
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcWriteTone(BUZZER, frequency);
#else
  ledcWriteTone(BUZZER_CHANNEL, frequency);
#endif
  delay(durationMs);
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcWriteTone(BUZZER, 0);
  ledcWrite(BUZZER, 0);
#else
  ledcWriteTone(BUZZER_CHANNEL, 0);
  ledcWrite(BUZZER_CHANNEL, 0);
#endif
}

void bootSound() {             // Short, bright device-start sound.
  beep(1200, 80); delay(45); beep(1650, 120);
}
void successSound() {          // Fast high double beep.
  beep(1650, 65); delay(40); beep(2100, 85);
}
void bluetoothConnectedSound() { // Different, gentle rising connection chime.
  beep(1050, 65); delay(35); beep(1400, 95);
}
void failureSound() {          // Clearly lower, descending double beep.
  beep(420, 100); delay(45); beep(300, 130);
}

void updateLeds() {
  bool red = false, blue = false;
  if (!pn532Ready) red = true;
  else if (!SerialBT.hasClient()) blue = (millis() / 600) % 2 == 0;
  else if (waitingForAck) blue = (millis() / 120) % 2 == 0;
  else blue = true;
  if (millis() < redErrorUntil) red = (millis() / 120) % 2 == 0;
  digitalWrite(RED_LED, red ? HIGH : LOW);
  digitalWrite(BLUE_LED, blue ? HIGH : LOW);
}

String uidToHex(const uint8_t *uid, uint8_t length) {
  String result;
  for (uint8_t i = 0; i < length; i++) { if (uid[i] < 0x10) result += '0'; result += String(uid[i], HEX); }
  result.toUpperCase();
  return result;
}

void failScan(const char *message) {
  Serial.println(message);
  waitingForAck = false;
  pendingUid = "";
  redErrorUntil = millis() + 700;
  failureSound();
}

void readBluetoothReplies() {
  while (SerialBT.available()) {
    char c = static_cast<char>(SerialBT.read());
    if (c == '\r') continue;
    if (c != '\n') { incomingLine += c; continue; }
    String line = incomingLine;
    incomingLine = "";
    line.trim();
    if (!line.startsWith("ACK:")) continue;
    int splitAt = line.lastIndexOf(':');
    if (splitAt < 5) continue;
    String uid = line.substring(4, splitAt);
    String result = line.substring(splitAt + 1);
    Serial.println("Bluetooth reply: " + line);
    if (!waitingForAck || uid != pendingUid) continue;
    waitingForAck = false;
    pendingUid = "";
    if (result == "OK") { Serial.println("Scan accepted by Supabase."); successSound(); }
    else failScan("Scan rejected or not uploaded.");
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(RED_LED, OUTPUT); pinMode(BLUE_LED, OUTPUT); pinMode(BUZZER, OUTPUT);
  buzzerSetup();
  digitalWrite(RED_LED, LOW); digitalWrite(BLUE_LED, LOW);
  bootSound();
  Serial.println("\n--- Tool Tracker Bluetooth NFC Scanner ---");
  SerialBT.begin(BT_NAME);
  Serial.println("Bluetooth SPP ready: ToolTracker-ESP32");
  SPI.begin(PN532_SCK, PN532_MISO, PN532_MOSI, PN532_SS);
  nfc.begin();
  if (nfc.getFirmwareVersion() == 0) Serial.println("PN532 unavailable; no NFC scans possible.");
  else { pn532Ready = true; nfc.SAMConfig(); Serial.println("PN532 ready."); }
}

void loop() {
  readBluetoothReplies();
  updateLeds();
  const bool bluetoothConnected = SerialBT.hasClient();
  if (bluetoothConnected && !wasBluetoothConnected) {
    Serial.println("Bluetooth bridge connected.");
    bluetoothConnectedSound();
  }
  wasBluetoothConnected = bluetoothConnected;
  if (bluetoothConnected && millis() - lastHeartbeatAt >= HEARTBEAT_MS) {
    lastHeartbeatAt = millis();
    SerialBT.println("STATUS:ONLINE");
  }
  if (!pn532Ready) return;
  if (waitingForAck && millis() > ackDeadline) { failScan("Upload acknowledgement timeout."); return; }

  uint8_t uid[7], uidLength = 0;
  if (!nfc.readPassiveTargetID(PN532_MIFARE_ISO14443A, uid, &uidLength, 80)) return;
  String uidHex = uidToHex(uid, uidLength);
  if (uidHex == lastUid && millis() - lastUidAt < DUPLICATE_MS) return;
  if (waitingForAck) return;
  lastUid = uidHex;
  lastUidAt = millis();
  if (!SerialBT.hasClient()) { failScan("Bluetooth bridge is not connected."); return; }
  SerialBT.println(String("UID:") + uidHex);
  Serial.println(String("UID sent: ") + uidHex);
  pendingUid = uidHex;
  waitingForAck = true;
  ackDeadline = millis() + ACK_TIMEOUT_MS;
}
