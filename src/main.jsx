import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  AlertTriangle,
  BadgePlus,
  Ban,
  Bluetooth,
  Check,
  CircleCheck,
  ClipboardCheck,
  ClipboardList,
  Clock3,
  Database,
  Eye,
  LogIn,
  LogOut,
  PackageCheck,
  PackageSearch,
  PackageX,
  Pencil,
  Plane,
  Radar,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  Trash2,
  Wrench,
  X
} from "lucide-react";
import { supabase, supabaseConfigured } from "./supabaseClient";
import "./styles.css";

const DEFAULT_WORKSHOP_NAME = "Aircraft Tools Workshop";
const STATUS_OPTIONS = ["Available", "Not Available", "Unserviceable"];
const ADMIN_PIN = import.meta.env.VITE_ADMIN_PIN;
const ADMIN_EMAIL = "muzwazir@gmail.com";
const SETTINGS_STORAGE_KEY = "aircraft-tool-tracker-settings";
const DEFAULT_SETTINGS = {
  workshopName: DEFAULT_WORKSHOP_NAME,
  scannerDeviceId: "ESP32-PN532-01",
  scannerNetworkLabel: "Bluetooth Classic SPP bridge on the workshop laptop",
  overdueDays: "1",
  fodAlertEnabled: true,
  adminPin: ""
};

const EMPTY_FACTS = [
  "Every NFC UID is unique, so one physical tool always has one digital identity.",
  "A complete borrow-and-return record improves workshop accountability and FOD prevention.",
  "Bluetooth keeps the ESP32 scanner independent from the workshop internet connection.",
  "Good tool control means the right tool is available at the right time."
];

function getSavedSettings() {
  try {
    return {
      ...DEFAULT_SETTINGS,
      ...JSON.parse(window.localStorage.getItem(SETTINGS_STORAGE_KEY) || "{}")
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

const NAV_ITEMS = [
  { id: "dashboard", label: "Dashboard", icon: Activity },
  { id: "inventory", label: "Inventory", icon: PackageSearch },
  { id: "master", label: "Master Data", icon: Database },
  { id: "history", label: "History", icon: ClipboardList },
  { id: "settings", label: "Settings", icon: Wrench }
];

function formatDate(value) {
  if (!value) return "Not recorded";

  return new Intl.DateTimeFormat("en-MY", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kuala_Lumpur"
  }).format(new Date(value));
}

function statusClass(status) {
  const normalized = status === "Not Available" ? "Borrowed" : status;
  return `status ${normalized.toLowerCase().replace(/\s+/g, "-")}`;
}

function getStatusLabel(status, reason) {
  if (status === "Not Available") return reason || "Borrowed";
  return status || "Available";
}

function getDisplayName(email) {
  const localPart = String(email || "Administrator").split("@")[0];
  return localPart
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ") || "Administrator";
}

function formatDuration(start, end) {
  if (!start || !end) return "Not returned";
  const milliseconds = Math.max(0, new Date(end).getTime() - new Date(start).getTime());
  const totalMinutes = Math.round(milliseconds / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
}

function isOverdueTool(tool, overdueDays) {
  return tool?.status === "Not Available" && tool?.availability_reason === "Borrowed" && tool?.borrowed_at &&
    Date.now() - new Date(tool.borrowed_at).getTime() >= Math.max(Number(overdueDays) || 1, 1) * 86400000;
}

function xmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function App() {
  const [activePage, setActivePage] = useState("dashboard");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [dashboard, setDashboard] = useState(null);
  const [today, setToday] = useState(null);
  const [summary, setSummary] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [notAvailable, setNotAvailable] = useState([]);
  const [todayList, setTodayList] = useState([]);
  const [historyRows, setHistoryRows] = useState([]);
  const [uidInput, setUidInput] = useState("");
  const [uidResult, setUidResult] = useState(null);
  const [uidMessage, setUidMessage] = useState("");
  const [checkout, setCheckout] = useState({
    studentName: "",
    studentId: "",
    staffName: ""
  });
  const [checkoutItems, setCheckoutItems] = useState([]);
  const [checkoutMessage, setCheckoutMessage] = useState("");
  const [staffVerified, setStaffVerified] = useState(false);
  const [checkoutSaving, setCheckoutSaving] = useState(false);
  const [scannerActive, setScannerActive] = useState(false);
  const [scannerDisconnected, setScannerDisconnected] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);
  const [masterScanActive, setMasterScanActive] = useState(false);
  const [masterScanBusy, setMasterScanBusy] = useState(false);
  const [masterScanStartedAt, setMasterScanStartedAt] = useState(null);
  const [processedScanIds, setProcessedScanIds] = useState([]);
  const [toasts, setToasts] = useState([]);
  const [returnStaffName, setReturnStaffName] = useState("");
  const [returnVerified, setReturnVerified] = useState(false);
  const [returnMessage, setReturnMessage] = useState("");
  const [returningUid, setReturningUid] = useState("");
  const [newTool, setNewTool] = useState({
    uid: "",
    toolName: "",
    toolCode: "",
    status: "Available",
    imageUrl: ""
  });
  const [inventoryMessage, setInventoryMessage] = useState("");
  const [savingTool, setSavingTool] = useState(false);
  const [deletingUid, setDeletingUid] = useState("");
  const [lastUpdated, setLastUpdated] = useState(null);
  const [showCheckoutConfirm, setShowCheckoutConfirm] = useState(false);
  const [showManualToolPicker, setShowManualToolPicker] = useState(false);
  const [editTool, setEditTool] = useState(null);
  const [toolDetail, setToolDetail] = useState(null);
  const [toolDetailHistory, setToolDetailHistory] = useState([]);
  const [toolDetailLoading, setToolDetailLoading] = useState(false);
  const [editMessage, setEditMessage] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [adminUnlocked, setAdminUnlocked] = useState(false);
  const [adminPinModal, setAdminPinModal] = useState(null);
  const [adminPinInput, setAdminPinInput] = useState("");
  const [adminPinError, setAdminPinError] = useState("");
  const [appSettings, setAppSettings] = useState(getSavedSettings);
  const [lastScanAt, setLastScanAt] = useState(null);
  const [scannerConnection, setScannerConnection] = useState({
    configured: null,
    online: false,
    lastSeen: null,
    error: ""
  });
  const [accessMode, setAccessMode] = useState(null);
  const [adminUser, setAdminUser] = useState(null);
  const [adminLogin, setAdminLogin] = useState({
    email: ADMIN_EMAIL,
    password: "",
    error: "",
    saving: false
  });
  const [studentLogin, setStudentLogin] = useState({
    email: "",
    password: "",
    error: "",
    saving: false
  });

  const checkoutRef = useRef(checkout);
  const checkoutItemsRef = useRef(checkoutItems);
  const processedScanIdsRef = useRef(processedScanIds);
  const scannerActiveRef = useRef(scannerActive);
  const scanBusyRef = useRef(scanBusy);

  const unavailableCount = dashboard?.not_available_tools ?? 0;
  const totalTools = dashboard?.total_tools ?? 0;
  const workshopName = appSettings.workshopName.trim() || DEFAULT_WORKSHOP_NAME;
  const effectiveAdminPin = appSettings.adminPin || ADMIN_PIN;
  const adminDisplayName = getDisplayName(adminUser?.email);

  const borrowedGroups = useMemo(() => {
    return notAvailable
      .filter((tool) => tool.availability_reason === "Borrowed")
      .reduce((groups, tool) => {
        const borrower = tool.current_borrower || "Unknown borrower";
        if (!groups[borrower]) groups[borrower] = [];
        groups[borrower].push(tool);
        return groups;
      }, {});
  }, [notAvailable]);

  const filteredTodayList = useMemo(() => todayList.slice(0, 6), [todayList]);

  const overdueTools = useMemo(() => {
    const overdueMs = Math.max(Number(appSettings.overdueDays) || 1, 1) * 24 * 60 * 60 * 1000;
    const now = Date.now();
    return notAvailable.filter((tool) => (
      tool.availability_reason === "Borrowed" &&
      tool.borrowed_at &&
      now - new Date(tool.borrowed_at).getTime() >= overdueMs
    ));
  }, [appSettings.overdueDays, notAvailable]);

  useEffect(() => {
    checkoutRef.current = checkout;
  }, [checkout]);

  useEffect(() => {
    checkoutItemsRef.current = checkoutItems;
  }, [checkoutItems]);

  useEffect(() => {
    processedScanIdsRef.current = processedScanIds;
  }, [processedScanIds]);

  useEffect(() => {
    scannerActiveRef.current = scannerActive;
  }, [scannerActive]);

  useEffect(() => {
    scanBusyRef.current = scanBusy;
  }, [scanBusy]);

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (!scannerActive) return undefined;

    const timer = window.setInterval(() => {
      pollScanEvents();
    }, 1300);

    pollScanEvents();
    return () => window.clearInterval(timer);
  }, [scannerActive]);

  useEffect(() => {
    if (!masterScanActive || !masterScanStartedAt) return undefined;
    const timer = window.setInterval(pollMasterScanEvent, 900);
    pollMasterScanEvent();
    return () => window.clearInterval(timer);
  }, [masterScanActive, masterScanStartedAt]);

  useEffect(() => {
    if (!supabaseConfigured) return undefined;

    let cancelled = false;
    const deviceId = appSettings.scannerDeviceId.trim() || DEFAULT_SETTINGS.scannerDeviceId;

    async function refreshScannerConnection() {
      const { data, error: statusError } = await supabase
        .from("scanner_status")
        .select("device_id, transport, last_seen")
        .eq("device_id", deviceId)
        .maybeSingle();

      if (cancelled) return;

      if (statusError) {
        // The main application remains usable even before the one-time status SQL is installed.
        setScannerConnection({
          configured: false,
          online: false,
          lastSeen: null,
          error: "Scanner status table is not configured yet."
        });
        return;
      }

      const lastSeen = data?.last_seen || null;
      const isOnline = Boolean(lastSeen) && Date.now() - new Date(lastSeen).getTime() < 25000;
      setScannerConnection({ configured: true, online: isOnline, lastSeen, error: "" });
    }

    refreshScannerConnection();
    const timer = window.setInterval(refreshScannerConnection, 10000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [appSettings.scannerDeviceId]);

  function pushToast(type, message) {
    const id = `${Date.now()}-${Math.random()}`;
    setToasts((current) => [...current, { id, type, message }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 3200);
  }

  function saveSettings(nextSettings) {
    const cleanedSettings = {
      ...nextSettings,
      workshopName: nextSettings.workshopName.trim() || DEFAULT_WORKSHOP_NAME,
      overdueDays: String(Math.max(Number(nextSettings.overdueDays) || 1, 1))
    };
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(cleanedSettings));
    setAppSettings(cleanedSettings);
    pushToast("success", "Settings saved on this browser.");
  }

  async function exportBorrowHistory() {
    const [historyResult, sessionsResult, toolsResult] = await Promise.all([
      supabase.from("borrow_history").select("*").order("created_at", { ascending: true }),
      supabase.from("borrow_sessions").select("*"),
      supabase.from("tools").select("uid, tool_name, tool_code")
    ]);

    const exportError = historyResult.error || sessionsResult.error || toolsResult.error;
    if (exportError) {
      pushToast("error", `Excel export failed: ${exportError.message}`);
      return;
    }

    const sessionsById = new Map((sessionsResult.data || []).map((session) => [String(session.id), session]));
    const toolsByUid = new Map((toolsResult.data || []).map((tool) => [tool.uid, tool]));
    const returnsByKey = new Map();
    (historyResult.data || []).filter((row) => row.action === "Returned").forEach((row) => {
      const key = `${row.session_id || "no-session"}:${row.tool_uid}`;
      if (!returnsByKey.has(key)) returnsByKey.set(key, row);
    });

    const rows = (historyResult.data || [])
      .filter((row) => row.action === "Borrowed")
      .map((borrow) => {
        const session = sessionsById.get(String(borrow.session_id)) || {};
        const tool = toolsByUid.get(borrow.tool_uid) || {};
        const returned = returnsByKey.get(`${borrow.session_id || "no-session"}:${borrow.tool_uid}`);
        const borrowedAt = borrow.borrowed_at || session.borrowed_at || borrow.created_at;
        const returnedAt = returned?.returned_at || null;
        return [
          borrow.session_id || "-",
          session.borrower_name || borrow.borrower_name || "-",
          session.borrower_id || "-",
          session.workshop || workshopName,
          tool.tool_name || "Tool record removed",
          tool.tool_code || "-",
          borrow.tool_uid || "-",
          formatDate(borrowedAt),
          returnedAt ? formatDate(returnedAt) : "Not returned",
          formatDuration(borrowedAt, returnedAt),
          returnedAt ? "Returned" : (session.status || "Active")
        ];
      });

    const headers = ["Session ID", "Student Name", "Student ID", "Workshop", "Tool Name", "Tool Code", "Tool UID", "Borrowed At", "Returned At", "Borrow Duration", "Current Status"];
    const sheetRows = [headers, ...rows]
      .map((row, index) => `<Row>${row.map((value) => `<Cell ss:StyleID=\"${index === 0 ? "header" : "cell"}\"><Data ss:Type=\"String\">${xmlEscape(value)}</Data></Cell>`).join("")}</Row>`)
      .join("");
    const spreadsheet = `<?xml version=\"1.0\"?><Workbook xmlns=\"urn:schemas-microsoft-com:office:spreadsheet\" xmlns:ss=\"urn:schemas-microsoft-com:office:spreadsheet\"><Styles><Style ss:ID=\"header\"><Font ss:Bold=\"1\"/><Interior ss:Color=\"#DDEFEA\" ss:Pattern=\"Solid\"/></Style><Style ss:ID=\"cell\"/></Styles><Worksheet ss:Name=\"Borrow History\"><Table>${sheetRows}</Table></Worksheet></Workbook>`;
    const downloadUrl = URL.createObjectURL(new Blob([spreadsheet], { type: "application/vnd.ms-excel;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = `borrow-history-${new Date().toISOString().slice(0, 10)}.xls`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(downloadUrl);
    pushToast("success", "Borrow history Excel exported.");
  }

  function handleToolImageFile(target, file) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setInventoryMessage("Please select an image file.");
      return;
    }
    if (file.size > 750000) {
      setInventoryMessage("Image must be 750 KB or smaller. Use a compressed tool photo.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const imageUrl = String(reader.result || "");
      if (target === "new") setNewTool((current) => ({ ...current, imageUrl }));
      else setEditTool((current) => ({ ...current, imageUrl }));
      setInventoryMessage("Tool image ready. Save the tool to keep it.");
    };
    reader.readAsDataURL(file);
  }

  async function signInAdmin(event) {
    event.preventDefault();
    const email = adminLogin.email.trim().toLowerCase();

    if (!supabaseConfigured) {
      setAdminLogin((current) => ({ ...current, error: "Supabase is not connected yet." }));
      return;
    }

    if (email !== ADMIN_EMAIL) {
      setAdminLogin((current) => ({ ...current, error: "This email is not registered as the system administrator." }));
      return;
    }

    setAdminLogin((current) => ({ ...current, error: "", saving: true }));
    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password: adminLogin.password
    });

    if (signInError || !data.user) {
      setAdminLogin((current) => ({ ...current, saving: false, error: signInError?.message || "Unable to sign in." }));
      return;
    }

    setAdminUser(data.user);
    setAdminLogin((current) => ({ ...current, password: "", saving: false }));
    setAccessMode("admin");
    pushToast("success", "Administrator signed in.");
  }

  async function signOutAdmin() {
    if (supabaseConfigured) await supabase.auth.signOut();
    setAdminUser(null);
    setAdminUnlocked(false);
    setAccessMode(null);
  }

  async function enterStudentView() {
    if (supabaseConfigured) await supabase.auth.signOut();
    setAdminUser(null);
    setAdminUnlocked(false);
    setActivePage("inventory");
    setAccessMode("student");
    await loadData();
  }

  async function signInStudent(event) {
    event.preventDefault();

    if (!supabaseConfigured) {
      setStudentLogin((current) => ({ ...current, error: "Supabase is not connected yet." }));
      return;
    }

    setStudentLogin((current) => ({ ...current, error: "", saving: true }));
    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email: studentLogin.email.trim().toLowerCase(),
      password: studentLogin.password
    });

    if (signInError || !data.user) {
      setStudentLogin((current) => ({ ...current, saving: false, error: signInError?.message || "Unable to sign in." }));
      return;
    }

    setStudentLogin((current) => ({ ...current, password: "", saving: false }));
    setActivePage("inventory");
    setAccessMode("student");
  }

  async function loadData() {
    if (!supabaseConfigured) {
      setLoading(false);
      setError("Add your Supabase URL and anon key in a .env file first.");
      return;
    }

    setLoading(true);
    setError("");

    const [
      dashboardResult,
      todayResult,
      summaryResult,
      inventoryResult,
      notAvailableResult,
      todayListResult,
      historyResult
    ] = await Promise.all([
      supabase.from("dashboard_stats").select("*").single(),
      supabase.from("today_dashboard_stats").select("*").single(),
      supabase.from("tool_summary").select("*"),
      supabase.from("tools").select("*").order("tool_name").order("tool_code"),
      supabase.from("current_not_available_tools").select("*"),
      supabase.from("today_borrow_list").select("*"),
      supabase.from("borrow_history").select("*").order("created_at", { ascending: false }).limit(80)
    ]);

    const firstError =
      dashboardResult.error ||
      todayResult.error ||
      summaryResult.error ||
      inventoryResult.error ||
      notAvailableResult.error ||
      todayListResult.error ||
      historyResult.error;

    if (firstError) {
      setError(firstError.message);
    } else {
      setDashboard(dashboardResult.data);
      setToday(todayResult.data);
      setSummary(summaryResult.data ?? []);
      setInventory(inventoryResult.data ?? []);
      setNotAvailable(notAvailableResult.data ?? []);
      setTodayList(todayListResult.data ?? []);
      setHistoryRows(historyResult.data ?? []);
      setLastUpdated(new Date());
    }

    setLoading(false);
  }

  function updateCheckoutField(field, value) {
    setCheckout((current) => ({ ...current, [field]: value }));
  }

  function updateNewToolField(field, value) {
    setNewTool((current) => ({ ...current, [field]: value }));
  }

  function requestAdminUnlock(targetPage = "master") {
    setAdminPinInput("");
    setAdminPinError("");
    setAdminPinModal({ targetPage });
  }

  function closeAdminPinModal() {
    setAdminPinModal(null);
    setAdminPinInput("");
    setAdminPinError("");
  }

  function verifyAdminPin(event) {
    event.preventDefault();

    if (!effectiveAdminPin) {
      setAdminPinError("Admin PIN is not configured in the environment file.");
      return;
    }

    if (adminPinInput.trim() !== effectiveAdminPin) {
      setAdminPinError("Incorrect Admin PIN. Access denied.");
      return;
    }

    setAdminUnlocked(true);
    setActivePage(adminPinModal?.targetPage ?? "master");
    closeAdminPinModal();
    pushToast("success", "Administrator access unlocked.");
  }

  function handleNavigation(pageId) {
    if (activePage === "master" && pageId !== "master") {
      setAdminUnlocked(false);
    }

    if (pageId === "master" && activePage !== "master") {
      requestAdminUnlock("master");
      return;
    }

    if (pageId === "settings" && !adminUnlocked) {
      requestAdminUnlock(pageId);
      return;
    }

    setActivePage(pageId);
  }

  async function findToolByUid(event) {
    event.preventDefault();
    const uid = uidInput.trim().toUpperCase();

    if (!uid) {
      setUidMessage("Enter or scan a UID first.");
      setUidResult(null);
      return;
    }

    setUidMessage("Searching Supabase...");
    setUidResult(null);

    const { data, error: lookupError } = await supabase
      .from("tools")
      .select("*")
      .eq("uid", uid)
      .maybeSingle();

    if (lookupError) {
      setUidMessage(lookupError.message);
      return;
    }

    if (!data) {
      setUidMessage("No tool found for this UID.");
      return;
    }

    setUidResult(data);
    setUidMessage("");
  }

  async function addToolToCheckoutByUid(uid, options = {}) {
    if (!supabaseConfigured) {
      setCheckoutMessage("Connect Supabase first.");
      return false;
    }

    const cleanUid = uid.trim().toUpperCase();

    if (!cleanUid) return false;

    if (checkoutItemsRef.current.some((item) => item.uid === cleanUid)) {
      pushToast("warning", "Tool already scanned.");
      return false;
    }

    const { data, error: lookupError } = await supabase
      .from("tools")
      .select("*")
      .eq("uid", cleanUid)
      .maybeSingle();

    if (lookupError) {
      pushToast("error", lookupError.message);
      return false;
    }

    if (!data) {
      pushToast("error", `Unknown UID: ${cleanUid}`);
      return false;
    }

    if (data.status !== "Available") {
      pushToast("warning", `${data.tool_name} ${data.tool_code} is not available.`);
      return false;
    }

    setCheckoutItems((current) => {
      if (current.some((item) => item.uid === cleanUid)) return current;
      return [...current, data];
    });
    pushToast("success", `${data.tool_name} ${data.tool_code} scanned.`);
    setCheckoutMessage(
      `${data.tool_name} ${data.tool_code} added${options.source ? ` from ${options.source}` : ""}.`
    );
    return true;
  }

  function addManualTool(tool) {
    if (tool.status !== "Available") {
      pushToast("warning", "Only available tools can be selected manually.");
      return;
    }

    if (checkoutItemsRef.current.some((item) => item.uid === tool.uid)) {
      pushToast("warning", "Tool already selected for this checkout.");
      return;
    }

    setCheckoutItems((current) => [...current, tool]);
    setCheckoutMessage(`${tool.tool_name} ${tool.tool_code} added manually as scanner backup.`);
    pushToast("success", `${tool.tool_name} added manually.`);
    setShowManualToolPicker(false);
  }

  async function markScanConsumed(scanId) {
    const { error: consumeError } = await supabase
      .from("scan_events")
      .update({ consumed: true })
      .eq("id", scanId);

    if (consumeError) {
      pushToast("error", consumeError.message);
    }
  }

  async function pollScanEvents() {
    if (!scannerActiveRef.current || scanBusyRef.current || !supabaseConfigured) return;

    setScanBusy(true);

    const { data: scanEvents, error: scanError } = await supabase
      .from("scan_events")
      .select("*")
      .eq("consumed", false)
      .order("created_at", { ascending: true })
      .limit(8);

    if (scanError) {
      setScannerDisconnected(true);
      pushToast("error", "Scanner disconnected.");
      setScanBusy(false);
      return;
    }

    setScannerDisconnected(false);

    for (const scanEvent of scanEvents ?? []) {
      if (processedScanIdsRef.current.includes(scanEvent.id)) continue;

      setProcessedScanIds((current) => [...current, scanEvent.id]);
      const added = await addToolToCheckoutByUid(scanEvent.uid, {
        source: scanEvent.device_id || "ESP32"
      });

      if (added || !added) {
        await markScanConsumed(scanEvent.id);
      }
    }

    if ((scanEvents ?? []).length > 0) {
      setLastScanAt(new Date());
    }

    setScanBusy(false);
  }

  async function pollMasterScanEvent() {
    if (!masterScanActive || masterScanBusy || !supabaseConfigured || !masterScanStartedAt) return;
    setMasterScanBusy(true);
    const { data: scanEvent, error: scanError } = await supabase
      .from("scan_events")
      .select("*")
      .eq("consumed", false)
      .gte("created_at", masterScanStartedAt)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (scanError) {
      setInventoryMessage(`Scanner error: ${scanError.message}`);
      setMasterScanActive(false);
    } else if (scanEvent?.uid) {
      const uid = String(scanEvent.uid).trim().toUpperCase();
      setNewTool((current) => ({ ...current, uid }));
      setInventoryMessage(`UID ${uid} scanned. Complete the tool name, code, and status, then click Add Tool.`);
      await markScanConsumed(scanEvent.id);
      setMasterScanActive(false);
      setMasterScanStartedAt(null);
      pushToast("success", `UID ${uid} added to the registration form.`);
    }
    setMasterScanBusy(false);
  }

  function startScanning() {
    const studentName = checkout.studentName.trim();
    const studentId = checkout.studentId.trim();

    if (!studentName || !studentId) {
      setCheckoutMessage("Enter student name and student ID before starting scanner.");
      pushToast("warning", "Student details required before scanning.");
      return;
    }

    setScannerDisconnected(false);
    setScannerActive(true);
    setCheckoutMessage("Scanner active. Scan tool tags continuously.");
    pushToast("success", "Scanner started.");
  }

  function startMasterScan() {
    if (!supabaseConfigured) return setInventoryMessage("Connect Supabase before scanning a new UID.");
    if (scannerActive) return setInventoryMessage("Stop the checkout scanner before scanning a new Master Data UID.");
    setMasterScanStartedAt(new Date().toISOString());
    setMasterScanActive(true);
    setInventoryMessage("Waiting for a new NFC UID. Tap the tag on PN532 now.");
  }

  function stopMasterScan() {
    setMasterScanActive(false);
    setMasterScanStartedAt(null);
    setMasterScanBusy(false);
    setInventoryMessage("New-item UID scanning cancelled.");
  }

  function stopScanning() {
    setScannerActive(false);
    setScanBusy(false);
    setCheckoutMessage("Scanner stopped.");
  }

  function removeCheckoutItem(uid) {
    setCheckoutItems((current) => current.filter((item) => item.uid !== uid));
    setCheckoutMessage("Tool removed from checkout.");
  }

  function prepareCheckoutConfirmation() {
    const studentName = checkout.studentName.trim();
    const studentId = checkout.studentId.trim();
    const staffName = checkout.staffName.trim();

    if (!studentName || !studentId) {
      setCheckoutMessage("Student name and student ID are required.");
      return;
    }

    if (checkoutItems.length === 0) {
      setCheckoutMessage("Scan at least one tool before completing checkout.");
      return;
    }

    if (!staffName || !staffVerified) {
      setCheckoutMessage("Staff name and verification checkbox are required.");
      return;
    }

    setCheckoutMessage("");
    setShowCheckoutConfirm(true);
  }

  async function completeCheckout() {
    const studentName = checkout.studentName.trim();
    const studentId = checkout.studentId.trim();
    const staffName = checkout.staffName.trim();

    setCheckoutSaving(true);
    setScannerActive(false);
    setCheckoutMessage("Completing checkout...");

    const borrowedAt = new Date().toISOString();
    const toolUids = checkoutItems.map((item) => item.uid);

    const { data: session, error: sessionError } = await supabase
      .from("borrow_sessions")
      .insert({
        borrower_name: studentName,
        borrower_id: studentId,
        workshop: workshopName,
        status: "Active",
        borrowed_at: borrowedAt
      })
      .select("id")
      .single();

    if (sessionError) {
      setCheckoutMessage(sessionError.message);
      setCheckoutSaving(false);
      return;
    }

    const { error: toolsError } = await supabase
      .from("tools")
      .update({
        status: "Not Available",
        availability_reason: "Borrowed",
        current_borrower: studentName,
        borrowed_at: borrowedAt,
        returned_at: null
      })
      .in("uid", toolUids);

    if (toolsError) {
      setCheckoutMessage(toolsError.message);
      setCheckoutSaving(false);
      return;
    }

    const historyRows = checkoutItems.map((item) => ({
      tool_uid: item.uid,
      borrower_name: studentName,
      borrowed_at: borrowedAt,
      action: "Borrowed",
      session_id: session.id
    }));

    const { error: historyError } = await supabase
      .from("borrow_history")
      .insert(historyRows);

    if (historyError) {
      setCheckoutMessage(historyError.message);
      setCheckoutSaving(false);
      return;
    }

    const auditRows = checkoutItems.map((item) => ({
      tool_uid: item.uid,
      action: "Checkout Verified",
      message: `${staffName} verified checkout for ${studentName} (${studentId}): ${item.tool_name} ${item.tool_code}.`
    }));

    const { error: auditError } = await supabase.from("audit_logs").insert(auditRows);

    if (auditError) {
      setCheckoutMessage(auditError.message);
      setCheckoutSaving(false);
      return;
    }

    setCheckout({
      studentName: "",
      studentId: "",
      staffName: ""
    });
    setCheckoutItems([]);
    setProcessedScanIds([]);
    setStaffVerified(false);
    setShowCheckoutConfirm(false);
    setCheckoutMessage(`Checkout completed. Session ID: ${session.id}`);
    setCheckoutSaving(false);
    pushToast("success", "Checkout completed.");
    await loadData();
  }

  async function returnTool(tool) {
    const staffName = returnStaffName.trim();

    if (!staffName || !returnVerified) {
      setReturnMessage("Staff name and verification checkbox are required.");
      return;
    }

    setReturningUid(tool.uid);
    setReturnMessage(`Returning ${tool.tool_name} ${tool.tool_code}...`);

    const returnedAt = new Date().toISOString();

    const { data: latestBorrow, error: borrowLookupError } = await supabase
      .from("borrow_history")
      .select("session_id, borrower_name, borrowed_at")
      .eq("tool_uid", tool.uid)
      .eq("action", "Borrowed")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (borrowLookupError) {
      setReturnMessage(borrowLookupError.message);
      setReturningUid("");
      return;
    }

    const borrowerName = latestBorrow?.borrower_name || tool.current_borrower || "Unknown";
    const sessionId = latestBorrow?.session_id || null;
    const borrowedAt = latestBorrow?.borrowed_at || tool.borrowed_at || returnedAt;

    const { error: toolError } = await supabase
      .from("tools")
      .update({
        status: "Available",
        availability_reason: null,
        current_borrower: null,
        returned_at: returnedAt
      })
      .eq("uid", tool.uid);

    if (toolError) {
      setReturnMessage(toolError.message);
      setReturningUid("");
      return;
    }

    const { error: historyError } = await supabase.from("borrow_history").insert({
      tool_uid: tool.uid,
      borrower_name: borrowerName,
      borrowed_at: borrowedAt,
      returned_at: returnedAt,
      action: "Returned",
      session_id: sessionId
    });

    if (historyError) {
      setReturnMessage(historyError.message);
      setReturningUid("");
      return;
    }

    const { error: auditError } = await supabase.from("audit_logs").insert({
      tool_uid: tool.uid,
      action: "Return Verified",
      message: `${staffName} verified return from ${borrowerName}: ${tool.tool_name} ${tool.tool_code}.`
    });

    if (auditError) {
      setReturnMessage(auditError.message);
      setReturningUid("");
      return;
    }

    if (sessionId) {
      const { data: sessionTools, error: sessionToolsError } = await supabase
        .from("borrow_history")
        .select("tool_uid")
        .eq("session_id", sessionId)
        .eq("action", "Borrowed");

      if (!sessionToolsError) {
        const sessionToolUids = [...new Set((sessionTools ?? []).map((item) => item.tool_uid))];
        const { data: openTools } = await supabase
          .from("tools")
          .select("uid")
          .in("uid", sessionToolUids)
          .eq("status", "Not Available")
          .eq("availability_reason", "Borrowed");

        if ((openTools ?? []).length === 0) {
          await supabase
            .from("borrow_sessions")
            .update({
              status: "Completed",
              returned_at: returnedAt
            })
            .eq("id", sessionId);
        }
      }
    }

    setReturnMessage(`${tool.tool_name} ${tool.tool_code} returned successfully.`);
    setReturningUid("");
    pushToast("success", `${tool.tool_name} returned.`);
    await loadData();
  }

  async function addInventoryTool(event) {
    event.preventDefault();

    const uid = newTool.uid.trim().toUpperCase();
    const toolName = newTool.toolName.trim();
    const toolCode = newTool.toolCode.trim().toUpperCase();

    if (!uid || !toolName || !toolCode) {
      setInventoryMessage("UID, tool name and tool code are required.");
      return;
    }

    if (inventory.some((tool) => tool.uid === uid)) {
      setInventoryMessage("This UID already exists in inventory.");
      return;
    }

    setSavingTool(true);
    setInventoryMessage("Adding tool...");

    const { error: insertError } = await supabase.from("tools").insert({
      uid,
      tool_name: toolName,
      tool_code: toolCode,
      status: newTool.status,
      availability_reason: newTool.status === "Available" ? null : newTool.status,
      current_borrower: null,
      workshop: workshopName,
      image_url: newTool.imageUrl || null
    });

    if (insertError) {
      setInventoryMessage(insertError.message);
      setSavingTool(false);
      return;
    }

    setNewTool({
      uid: "",
      toolName: "",
      toolCode: "",
      status: "Available",
      imageUrl: ""
    });
    setInventoryMessage(`${toolName} ${toolCode} added.`);
    setSavingTool(false);
    await loadData();
  }

  async function deleteInventoryTool(tool) {
    if (tool.status !== "Available") {
      setInventoryMessage("Only available tools can be deleted.");
      return;
    }

    setDeletingUid(tool.uid);
    setInventoryMessage(`Deleting ${tool.tool_name} ${tool.tool_code}...`);

    const { data: deletedTools, error: deleteError } = await supabase
      .from("tools")
      .delete()
      .eq("uid", tool.uid)
      .select("uid");

    if (deleteError) {
      setInventoryMessage(
        `${deleteError.message}. If this tool has borrow history, keep it in the system instead of deleting it.`
      );
      setDeletingUid("");
      return;
    }

    if (!deletedTools?.some((deletedTool) => deletedTool.uid === tool.uid)) {
      setInventoryMessage(
        "No tool was removed. Supabase is blocking delete access; add the tools DELETE policy in Supabase SQL Editor."
      );
      setDeletingUid("");
      return;
    }

    setInventoryMessage(`${tool.tool_name} ${tool.tool_code} deleted.`);
    setDeletingUid("");
    await loadData();
  }

  function openEditTool(tool) {
    setEditMessage("");
    setEditTool({
      originalUid: tool.uid,
      uid: tool.uid,
      toolName: tool.tool_name,
      toolCode: tool.tool_code,
      status: tool.status,
      imageUrl: tool.image_url || ""
    });
  }

  async function openToolDetail(tool) {
    setToolDetail(tool);
    setToolDetailHistory([]);
    setToolDetailLoading(true);
    const { data, error: detailError } = await supabase
      .from("borrow_history")
      .select("*")
      .eq("tool_uid", tool.uid)
      .order("created_at", { ascending: false });
    if (detailError) pushToast("warning", "Tool details opened, but its history could not be loaded.");
    else setToolDetailHistory(data || []);
    setToolDetailLoading(false);
  }

  function updateEditToolField(field, value) {
    setEditTool((current) => ({ ...current, [field]: value }));
  }

  async function saveEditedTool(event) {
    event.preventDefault();

    if (!editTool) return;

    const uid = editTool.uid.trim().toUpperCase();
    const toolName = editTool.toolName.trim();
    const toolCode = editTool.toolCode.trim().toUpperCase();
    const status = editTool.status;

    if (!uid || !toolName || !toolCode || !status) {
      setEditMessage("UID, tool name, tool code and status are required.");
      return;
    }

    const duplicateUid = inventory.some(
      (tool) => tool.uid === uid && tool.uid !== editTool.originalUid
    );

    if (duplicateUid) {
      setEditMessage("This UID already exists in inventory.");
      return;
    }

    setSavingEdit(true);
    setEditMessage("Saving changes...");

    const { error: updateError } = await supabase
      .from("tools")
      .update({
        uid,
        tool_name: toolName,
        tool_code: toolCode,
        status,
        availability_reason: status === "Available" ? null : status,
        workshop: workshopName,
        image_url: editTool.imageUrl || null
      })
      .eq("uid", editTool.originalUid);

    if (updateError) {
      setEditMessage(updateError.message);
      setSavingEdit(false);
      return;
    }

    setEditTool(null);
    setSavingEdit(false);
    setInventoryMessage(`${toolName} ${toolCode} updated.`);
    await loadData();
  }

  function renderActivePage() {
    if (loading) {
      return (
        <section className="table-card">
          <p className="empty">Loading Supabase data...</p>
        </section>
      );
    }

    if (activePage === "inventory") {
      return <InventoryTable onOpenTool={openToolDetail} overdueDays={appSettings.overdueDays} rows={inventory} />;
    }

    if (activePage === "master") {
      if (!adminUnlocked) {
        return <AdminLockedPanel onUnlock={() => requestAdminUnlock("master")} />;
      }

      return (
        <InventoryManager
          deletingUid={deletingUid}
          inventoryMessage={inventoryMessage}
          masterScanActive={masterScanActive}
          masterScanBusy={masterScanBusy}
          newTool={newTool}
          onAddTool={addInventoryTool}
          onDeleteTool={deleteInventoryTool}
          onEditTool={openEditTool}
          onOpenTool={openToolDetail}
          overdueDays={appSettings.overdueDays}
          onStartMasterScan={startMasterScan}
          onStopMasterScan={stopMasterScan}
          onSelectImage={(file) => handleToolImageFile("new", file)}
          onUpdateNewTool={updateNewToolField}
          rows={inventory}
          savingTool={savingTool}
        />
      );
    }

    if (activePage === "history") {
      return <HistoryPage historyRows={historyRows} inventory={inventory} onOpenTool={openToolDetail} overdueDays={appSettings.overdueDays} todayList={todayList} />;
    }

    if (activePage === "settings") {
      if (!adminUnlocked) {
        return <AdminLockedPanel onUnlock={() => requestAdminUnlock("settings")} />;
      }

      return (
        <SettingsPage
          appSettings={appSettings}
          lastScanAt={lastScanAt}
          onExportHistory={exportBorrowHistory}
          onRefreshData={loadData}
          onSaveSettings={saveSettings}
          overdueTools={overdueTools}
          scannerActive={scannerActive}
          scannerConnection={scannerConnection}
          scannerDisconnected={scannerDisconnected}
          supabaseConfigured={supabaseConfigured}
          totalTools={totalTools}
          unserviceableCount={inventory.filter((tool) => tool.status === "Unserviceable").length}
        />
      );
    }

    return (
      <>
        <StatsGrid dashboard={dashboard} totalTools={totalTools} unavailableCount={unavailableCount} />
        <section className="dashboard-grid">
          <CheckoutPanel
            checkout={checkout}
            checkoutItems={checkoutItems}
            checkoutMessage={checkoutMessage}
            checkoutSaving={checkoutSaving}
            scannerActive={scannerActive}
            scannerDisconnected={scannerDisconnected}
            scanBusy={scanBusy}
            staffVerified={staffVerified}
            onPrepareCheckout={prepareCheckoutConfirmation}
            onOpenManualPicker={() => setShowManualToolPicker(true)}
            onRemoveCheckoutItem={removeCheckoutItem}
            onOpenTool={openToolDetail}
            onStartScanning={startScanning}
            onStopScanning={stopScanning}
            onUpdateCheckoutField={updateCheckoutField}
            setStaffVerified={setStaffVerified}
          />
          <ReturnPanel
            borrowedGroups={borrowedGroups}
            returnMessage={returnMessage}
            returnStaffName={returnStaffName}
            returnVerified={returnVerified}
            returningUid={returningUid}
            onReturnTool={returnTool}
            onOpenTool={openToolDetail}
            overdueDays={appSettings.overdueDays}
            setReturnStaffName={setReturnStaffName}
            setReturnVerified={setReturnVerified}
          />
          <UidLookupPanel
            uidInput={uidInput}
            uidMessage={uidMessage}
            uidResult={uidResult}
            onFindToolByUid={findToolByUid}
            setUidInput={setUidInput}
          />
          <TodayPanel filteredTodayList={filteredTodayList} today={today} />
        </section>
      </>
    );
  }

  if (!accessMode) {
    return <AccessChoice onAdmin={() => setAccessMode("admin-login")} onStudent={enterStudentView} />;
  }

  if (accessMode === "admin-login") {
    return (
      <AdminSignIn
        login={adminLogin}
        onBack={() => setAccessMode(null)}
        onChange={(field, value) => setAdminLogin((current) => ({ ...current, [field]: value, error: "" }))}
        onSubmit={signInAdmin}
      />
    );
  }

  if (accessMode === "student-login") {
    return (
      <StudentSignIn
        login={studentLogin}
        onBack={() => setAccessMode(null)}
        onChange={(field, value) => setStudentLogin((current) => ({ ...current, [field]: value, error: "" }))}
        onSubmit={signInStudent}
      />
    );
  }

  if (accessMode === "student") {
    return <StudentPortal error={error} loading={loading} onExit={signOutAdmin} rows={inventory} workshopName={workshopName} />;
  }

  return (
    <main className="app-frame">
      <Sidebar activePage={activePage} onNavigate={handleNavigation} />

      <section className="app-shell">
        <header className="topbar">
          <div className="brand-lockup">
            <img
              alt="UniKL logo"
              className="brand-logo"
              onError={(event) => {
                event.currentTarget.style.display = "none";
              }}
              src="/logo-unikl.png"
            />
            <div>
              <p className="eyebrow">Final Year Project</p>
              <h1>{workshopName}</h1>
              <p className="subtitle">
                MRO tool accountability system for controlled aircraft maintenance operations
              </p>
            </div>
          </div>
          <div className="live-sync">
            <span className="sync-dot" />
            <div>
              <strong>Hi, {adminDisplayName}</strong>
              <span>Administrator account</span>
            </div>
            <div className="sync-divider" />
            <div>
              <strong>Live Sync</strong>
              <span>Last Updated {lastUpdated ? formatDate(lastUpdated) : "Not yet"}</span>
            </div>
            <button className="refresh-icon-button" onClick={loadData} type="button" aria-label="Refresh data">
              <RefreshCw size={17} />
            </button>
            <button className="refresh-icon-button" onClick={signOutAdmin} type="button" aria-label="Sign out administrator">
              <LogOut size={17} />
            </button>
          </div>
        </header>

        {!supabaseConfigured && (
          <section className="notice">
            <Database size={20} />
            <div>
              <strong>Supabase is not connected yet.</strong>
              <span>Create a .env file using .env.example, then restart the dev server.</span>
            </div>
          </section>
        )}

        {error && (
          <section className="notice danger">
            <AlertTriangle size={20} />
            <div>
              <strong>Database message</strong>
              <span>{error}</span>
            </div>
          </section>
        )}

        {renderActivePage()}

        <footer className="footer-note">
          <div>
            <Plane size={17} />
            <strong>Aircraft Workshop Tool Tracking System</strong>
          </div>
          <span>Developed for Universiti Kuala Lumpur MIAT</span>
          <span>Powered by React, Supabase, ESP32 & PN532 NFC</span>
        </footer>
      </section>

      <ToastStack toasts={toasts} />

      {showCheckoutConfirm && (
        <CheckoutConfirmModal
          checkout={checkout}
          checkoutItems={checkoutItems}
          checkoutSaving={checkoutSaving}
          onCancel={() => setShowCheckoutConfirm(false)}
          onConfirm={completeCheckout}
        />
      )}

      {showManualToolPicker && (
        <ManualToolPicker
          onCancel={() => setShowManualToolPicker(false)}
          onSelect={addManualTool}
          rows={inventory.filter((tool) => (
            String(tool.status || "").trim().toLowerCase() === "available" &&
            !tool.availability_reason &&
            !tool.current_borrower
          ))}
        />
      )}

      {editTool && (
        <EditToolModal
          editMessage={editMessage}
          editTool={editTool}
          onCancel={() => setEditTool(null)}
          onSave={saveEditedTool}
          onSelectImage={(file) => handleToolImageFile("edit", file)}
          onUpdate={updateEditToolField}
          savingEdit={savingEdit}
        />
      )}

      {toolDetail && (
        <ToolDetailModal
          historyRows={toolDetailHistory}
          loading={toolDetailLoading}
          onClose={() => setToolDetail(null)}
          overdue={isOverdueTool(toolDetail, appSettings.overdueDays)}
          tool={toolDetail}
        />
      )}

      {adminPinModal && (
        <AdminPinModal
          adminPinError={adminPinError}
          adminPinInput={adminPinInput}
          onCancel={closeAdminPinModal}
          onSubmit={verifyAdminPin}
          setAdminPinInput={setAdminPinInput}
        />
      )}
    </main>
  );
}

function AccessChoice({ onAdmin, onStudent }) {
  return (
    <main className="access-page">
      <section className="access-card">
        <Plane className="access-plane" size={38} />
        <p className="eyebrow">Aircraft Tools Workshop</p>
        <h1>Tool Tracking System</h1>
        <p className="subtitle">Choose your access level to continue.</p>
        <div className="access-options">
          <button className="access-option admin-option" onClick={onAdmin} type="button">
            <ShieldCheck size={28} />
            <span><strong>Administrator</strong><small>Sign in to manage tools, borrowing, returns, settings, and records.</small></span>
            <LogIn size={20} />
          </button>
          <button className="access-option" onClick={onStudent} type="button">
            <Eye size={28} />
            <span><strong>Student</strong><small>View registered tools and their current availability only.</small></span>
            <LogIn size={20} />
          </button>
        </div>
        <p className="access-note">Student access cannot edit, borrow, return, delete, or export records.</p>
      </section>
    </main>
  );
}

function AdminSignIn({ login, onBack, onChange, onSubmit }) {
  return (
    <main className="access-page">
      <section className="access-card sign-in-card">
        <ShieldCheck className="access-plane" size={38} />
        <p className="eyebrow">Administrator Access</p>
        <h1>Sign in securely</h1>
        <p className="subtitle">Only the authorised administrator can access operational controls.</p>
        <form className="access-form" onSubmit={onSubmit}>
          <label>Email<input autoComplete="email" onChange={(event) => onChange("email", event.target.value)} type="email" value={login.email} /></label>
          <label>Password<input autoComplete="current-password" onChange={(event) => onChange("password", event.target.value)} type="password" value={login.password} /></label>
          {login.error && <p className="danger-text">{login.error}</p>}
          <div className="access-actions">
            <button className="secondary-button" onClick={onBack} type="button">Back</button>
            <button className="complete-button" disabled={login.saving} type="submit"><LogIn size={18} />{login.saving ? "Signing in..." : "Sign in"}</button>
          </div>
        </form>
      </section>
    </main>
  );
}

function StudentSignIn({ login, onBack, onChange, onSubmit }) {
  return (
    <main className="access-page">
      <section className="access-card sign-in-card">
        <Eye className="access-plane" size={38} />
        <p className="eyebrow">Student Access - Read Only</p>
        <h1>Sign in to view tools</h1>
        <p className="subtitle">Your account can view current tool availability but cannot change any record.</p>
        <form className="access-form" onSubmit={onSubmit}>
          <label>Email<input autoComplete="email" onChange={(event) => onChange("email", event.target.value)} type="email" value={login.email} /></label>
          <label>Password<input autoComplete="current-password" onChange={(event) => onChange("password", event.target.value)} type="password" value={login.password} /></label>
          {login.error && <p className="danger-text">{login.error}</p>}
          <div className="access-actions">
            <button className="secondary-button" onClick={onBack} type="button">Back</button>
            <button className="complete-button" disabled={login.saving} type="submit"><LogIn size={18} />{login.saving ? "Signing in..." : "View tools"}</button>
          </div>
        </form>
      </section>
    </main>
  );
}

function StudentPortal({ error, loading, onExit, rows, workshopName }) {
  return (
    <main className="app-frame">
      <section className="student-shell">
        <header className="student-header">
          <div><p className="eyebrow">Student View - Read Only</p><h1>{workshopName}</h1><p className="subtitle">Check registered tools and their current availability.</p></div>
          <button className="secondary-button" onClick={onExit} type="button">Change access</button>
        </header>
        {loading && <section className="table-card"><p className="empty">Loading inventory...</p></section>}
        {error && <section className="notice danger"><AlertTriangle size={20} /><div><strong>Unable to load inventory</strong><span>{error}</span></div></section>}
        {!loading && !error && (
          <section className="table-card page-panel">
            <div className="section-heading"><PackageSearch size={20} /><div><h2>Tool Availability</h2><p>Read-only inventory information.</p></div></div>
            <div className="table-wrap"><table><thead><tr><th>Tool</th><th>Code</th><th>UID</th><th>Status</th></tr></thead><tbody>{rows.map((tool) => <tr key={`student-${tool.uid}`}><td>{tool.tool_name}</td><td>{tool.tool_code}</td><td className="mono">{tool.uid}</td><td><StatusBadge reason={tool.availability_reason} status={tool.status} /></td></tr>)}</tbody></table></div>
          </section>
        )}
      </section>
    </main>
  );
}

function Sidebar({ activePage, onNavigate }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <Plane size={22} />
        <span>Tool Control</span>
      </div>
      <nav>
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          return (
            <button
              className={activePage === item.id ? "sidebar-link active" : "sidebar-link"}
              key={item.id}
              onClick={() => onNavigate(item.id)}
              type="button"
            >
              <Icon size={20} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}

function AdminLockedPanel({ onUnlock }) {
  return (
    <section className="table-card page-panel admin-lock-panel">
      <div className="section-heading">
        <ShieldCheck size={20} />
        <div>
          <h2>Administrator Area</h2>
          <p>Master data is available for administrator use only.</p>
        </div>
      </div>

      <div className="admin-lock-content">
        <div>
          <strong>Admin PIN Required</strong>
          <span>
            Routine workshop operations remain open. Equipment registration, UID changes,
            editing, deleting and sensitive settings require administrator verification.
          </span>
        </div>
        <button className="complete-button" onClick={onUnlock} type="button">
          <ShieldCheck size={18} />
          Unlock Master Data
        </button>
      </div>
    </section>
  );
}

function AdminPinModal({
  adminPinError,
  adminPinInput,
  onCancel,
  onSubmit,
  setAdminPinInput
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal-card admin-pin-card" role="dialog" aria-modal="true" aria-labelledby="admin-pin-title">
        <div className="modal-header">
          <div>
            <p className="eyebrow">Administrator Verification</p>
            <h2 id="admin-pin-title">Enter Admin PIN</h2>
          </div>
          <button className="modal-close" onClick={onCancel} type="button" aria-label="Close admin PIN">
            <X size={18} />
          </button>
        </div>

        <form className="admin-pin-form" onSubmit={onSubmit}>
          <label>
            Admin PIN
            <input
              autoFocus
              inputMode="numeric"
              type="password"
              value={adminPinInput}
              onChange={(event) => setAdminPinInput(event.target.value)}
              placeholder="Enter PIN"
            />
          </label>

          {adminPinError && <p className="helper-text danger-text">{adminPinError}</p>}

          <div className="modal-actions">
            <button className="secondary-button" onClick={onCancel} type="button">
              Cancel
            </button>
            <button className="complete-button" type="submit">
              <ShieldCheck size={18} />
              Unlock
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function StatsGrid({ dashboard, totalTools, unavailableCount }) {
  return (
    <section className="stats-grid">
      <StatCard
        icon={Wrench}
        label="Total Tools"
        progress={100}
        subtitle="Current Inventory Status"
        value={dashboard?.total_tools}
      />
      <StatCard
        icon={PackageCheck}
        label="Serviceable"
        progress={totalTools ? ((dashboard?.available_tools ?? 0) / totalTools) * 100 : 0}
        subtitle="Current Inventory Status"
        value={dashboard?.available_tools}
        tone="good"
      />
      <StatCard
        icon={PackageX}
        label="Controlled Out"
        progress={totalTools ? (unavailableCount / totalTools) * 100 : 0}
        subtitle="Current Inventory Status"
        value={unavailableCount}
        tone={unavailableCount > 0 ? "warn" : "good"}
      />
      <StatCard
        icon={ClipboardCheck}
        label="Active Issue Records"
        progress={totalTools ? ((dashboard?.active_sessions ?? 0) / totalTools) * 100 : 0}
        subtitle="Current Inventory Status"
        value={dashboard?.active_sessions}
      />
    </section>
  );
}

function CheckoutPanel({
  checkout,
  checkoutItems,
  checkoutMessage,
  checkoutSaving,
  scannerActive,
  scannerDisconnected,
  scanBusy,
  staffVerified,
  onPrepareCheckout,
  onOpenManualPicker,
  onOpenTool,
  onRemoveCheckoutItem,
  onStartScanning,
  onStopScanning,
  onUpdateCheckoutField,
  setStaffVerified
}) {
  return (
    <section className="checkout-panel">
      <div className="section-heading">
        <ClipboardCheck size={20} />
        <div>
          <h2>Tool Issue Control</h2>
          <p>Record student custody, activate scanner, and verify issue authorization.</p>
        </div>
      </div>

      <div className="checkout-layout">
        <div className="checkout-form">
          <label>
            Student Name
            <input
              value={checkout.studentName}
              onChange={(event) => onUpdateCheckoutField("studentName", event.target.value)}
              placeholder="Example: Ali Ahmad"
            />
          </label>
          <label>
            Student ID
            <input
              value={checkout.studentId}
              onChange={(event) => onUpdateCheckoutField("studentId", event.target.value)}
              placeholder="Example: S12345"
            />
          </label>
        </div>

        <div className="scanner-control">
          <ScannerStatus
            scannerActive={scannerActive}
            scannerDisconnected={scannerDisconnected}
            scanBusy={scanBusy}
          />
          <div className="scanner-actions">
            {!scannerActive ? (
              <button className="complete-button" onClick={onStartScanning} type="button">
                <ScanLine size={18} />
                Start Scanning
              </button>
            ) : (
              <button className="secondary-button" onClick={onStopScanning} type="button">
                <X size={18} />
                Stop Scanning
              </button>
            )}
            <button className="secondary-button" onClick={onOpenManualPicker} type="button">
              <PackageSearch size={18} />
              Select Tool Manually
            </button>
          </div>
        </div>
      </div>

      {checkoutMessage && <p className="helper-text">{checkoutMessage}</p>}

      <div className="scanned-tools-section">
        <div className="section-heading compact">
          <Radar size={18} />
          <div>
            <h2>Scanned Tools</h2>
            <p>Unique UIDs from ESP32 appear here automatically while scanning is active.</p>
          </div>
        </div>

        <div className="checkout-list">
          {checkoutItems.length === 0 && (
            <EmptyState message="No tools scanned for this checkout yet." factIndex={0} />
          )}
          {checkoutItems.map((item) => (
            <article className="checkout-item" key={item.uid}>
              <button className="tool-row-info tool-link" onClick={() => onOpenTool(item)} type="button">
                <ToolThumbnail imageUrl={item.image_url} name={item.tool_name} size="small" />
                <div>
                <strong>{item.tool_name}</strong>
                <span>{item.tool_code} | UID {item.uid}</span>
                </div>
              </button>
              <StatusBadge reason={item.availability_reason} status={item.status} />
              <button
                className="remove-button"
                onClick={() => onRemoveCheckoutItem(item.uid)}
                type="button"
                aria-label={`Remove ${item.tool_name}`}
              >
                Remove
              </button>
            </article>
          ))}
        </div>
      </div>

      <div className="verify-strip">
        <label>
          Staff Name
          <input
            value={checkout.staffName}
            onChange={(event) => onUpdateCheckoutField("staffName", event.target.value)}
            placeholder="Staff verifying checkout"
          />
        </label>
        <label className="checkbox-row">
          <input
            checked={staffVerified}
            onChange={(event) => setStaffVerified(event.target.checked)}
            type="checkbox"
          />
          I verify this checkout
        </label>
        <button
          className="complete-button"
          disabled={checkoutSaving}
          onClick={onPrepareCheckout}
          type="button"
        >
          <Check size={18} />
          {checkoutSaving ? "Completing..." : "Complete Checkout"}
        </button>
      </div>
    </section>
  );
}

function ScannerStatus({ scannerActive, scannerDisconnected, scanBusy }) {
  const status = scannerDisconnected
    ? "disconnected"
    : scannerActive
      ? "active"
      : "stopped";

  const label = scannerDisconnected
    ? "Scanner Disconnected"
    : scannerActive
      ? "Scanning"
      : "Scanner Stopped";

  return (
    <div className={`scanner-status ${status}`}>
      <span />
      <strong>{label}</strong>
    </div>
  );
}

function ReturnPanel({
  borrowedGroups,
  returnMessage,
  returnStaffName,
  returnVerified,
  returningUid,
  onReturnTool,
  onOpenTool,
  overdueDays,
  setReturnStaffName,
  setReturnVerified
}) {
  return (
    <section className="return-panel">
      <div className="section-heading">
        <Wrench size={20} />
        <div>
          <h2>Return & Tool Accountability</h2>
          <p>Borrowed tools are grouped by custodian for faster MRO return verification.</p>
        </div>
      </div>

      <div className="return-verify-row">
        <label>
          Staff Name
          <input
            value={returnStaffName}
            onChange={(event) => setReturnStaffName(event.target.value)}
            placeholder="Staff verifying return"
          />
        </label>
        <label className="checkbox-row">
          <input
            checked={returnVerified}
            onChange={(event) => setReturnVerified(event.target.checked)}
            type="checkbox"
          />
          I verify this return
        </label>
      </div>

      {returnMessage && <p className="helper-text">{returnMessage}</p>}

      <div className="borrower-list">
        {Object.keys(borrowedGroups).length === 0 && (
          <EmptyState message="No borrowed tools currently need return." factIndex={3} />
        )}

        {Object.entries(borrowedGroups).map(([borrower, tools]) => (
          <article className="borrower-card" key={borrower}>
            <div className="borrower-card-header">
              <div>
                <strong>{borrower}</strong>
                <span>{tools.length} borrowed tool{tools.length === 1 ? "" : "s"}</span>
              </div>
            </div>

            <div className="return-tool-list">
              {tools.map((tool) => (
                <div className="return-tool-row" key={tool.uid}>
                  <button className="tool-row-info tool-link" onClick={() => onOpenTool(tool)} type="button">
                    <ToolThumbnail imageUrl={tool.image_url} name={tool.tool_name} size="small" />
                    <div>
                    <strong>{tool.tool_name}</strong>
                    <span>{tool.tool_code} | Borrowed {formatDate(tool.borrowed_at)}</span>
                    </div>
                  </button>
                  <div className="return-item-actions">
                    <StatusBadge reason={tool.availability_reason} status={tool.status} />
                    {isOverdueTool(tool, overdueDays) && <span className="overdue-badge">Overdue</span>}
                    <button
                      className="complete-button"
                      disabled={returningUid === tool.uid}
                      onClick={() => onReturnTool(tool)}
                      type="button"
                    >
                      <Check size={18} />
                      {returningUid === tool.uid ? "Returning..." : "Return"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function UidLookupPanel({ uidInput, uidMessage, uidResult, onFindToolByUid, setUidInput }) {
  return (
    <section className="scan-panel">
      <div className="section-heading">
        <Radar size={20} />
        <div>
          <h2>NFC UID Trace</h2>
          <p>Manual lookup for a scanned UID without changing checkout records.</p>
        </div>
      </div>

      <form className="lookup-form" onSubmit={onFindToolByUid}>
        <input
          value={uidInput}
          onChange={(event) => setUidInput(event.target.value)}
          placeholder="Example: F9D99729"
          aria-label="NFC UID"
        />
        <button type="submit">Find Tool</button>
      </form>

      {uidMessage && <p className="helper-text">{uidMessage}</p>}

      {uidResult && (
        <article className="tool-result">
          <ToolThumbnail imageUrl={uidResult.image_url} name={uidResult.tool_name} />
          <div>
            <p className="tool-code">{uidResult.tool_code}</p>
            <h3>{uidResult.tool_name}</h3>
          </div>
          <StatusBadge reason={uidResult.availability_reason} status={uidResult.status} />
          <dl>
            <div>
              <dt>UID</dt>
              <dd>{uidResult.uid}</dd>
            </div>
            <div>
              <dt>Workshop</dt>
              <dd>{uidResult.workshop}</dd>
            </div>
            <div>
              <dt>Reason</dt>
              <dd>{uidResult.availability_reason || "None"}</dd>
            </div>
            <div>
              <dt>Borrower</dt>
              <dd>{uidResult.current_borrower || "None"}</dd>
            </div>
          </dl>
        </article>
      )}
    </section>
  );
}

function TodayPanel({ filteredTodayList, today }) {
  return (
    <section className="today-panel">
      <div className="section-heading">
        <Activity size={20} />
        <div>
          <h2>Daily Maintenance Movement</h2>
          <p>Operational issue and return activity for today's workshop control log.</p>
        </div>
      </div>
      <div className="mini-stats">
        <MiniStat label="Borrowed" value={today?.borrowed_today} />
        <MiniStat label="Returned" value={today?.returned_today} />
        <MiniStat label="Active" value={today?.active_sessions_today} />
        <MiniStat label="Completed" value={today?.completed_sessions_today} />
      </div>
      <div className="activity-list">
        {filteredTodayList.length === 0 && <EmptyState message="No activity has been recorded today." factIndex={3} />}
        {filteredTodayList.map((item) => (
          <div className="activity-row timeline-row" key={`${item.created_at}-${item.tool_code}`}>
            <span className="timeline-dot" />
            <span className="activity-time">{formatDate(item.created_at)}</span>
            <div><strong>{item.borrower_name}</strong><span>{item.action} · {item.tool_name} {item.tool_code}</span></div>
          </div>
        ))}
      </div>
    </section>
  );
}

function StatCard({ icon: Icon, label, progress = 0, subtitle, value, tone = "neutral" }) {
  const safeProgress = Math.max(0, Math.min(100, progress));

  return (
    <article className={`stat-card ${tone}`}>
      <div className="stat-card-top">
        <Icon size={22} />
        <span>{label}</span>
      </div>
      <strong className="counter-value">{value ?? "--"}</strong>
      <small>{subtitle}</small>
      <div className="stat-progress" aria-hidden="true">
        <span style={{ width: `${safeProgress}%` }} />
      </div>
    </article>
  );
}

function StatusBadge({ reason, status }) {
  const label = getStatusLabel(status, reason);
  const className = statusClass(label);
  const Icon =
    label === "Available"
      ? CircleCheck
      : label === "Maintenance"
        ? Wrench
        : label === "Reserved"
          ? Clock3
          : Ban;

  return (
    <span className={className}>
      <Icon size={14} />
      {label}
    </span>
  );
}

function MiniStat({ label, value }) {
  return (
    <div className="mini-stat">
      <span>{label}</span>
      <strong>{value ?? "--"}</strong>
    </div>
  );
}

function ToolThumbnail({ imageUrl, name, size = "normal" }) {
  return (
    <div className={`tool-thumbnail ${size}`} aria-hidden="true">
      {imageUrl ? <img alt="" src={imageUrl} /> : <Wrench size={size === "small" ? 15 : 20} />}
    </div>
  );
}

function EmptyState({ message, factIndex = 0 }) {
  return (
    <div className="empty-state">
      <PackageSearch size={28} />
      <strong>{message}</strong>
      <span>Fun fact: {EMPTY_FACTS[factIndex % EMPTY_FACTS.length]}</span>
    </div>
  );
}

function InventoryTable({ onOpenTool, overdueDays, rows }) {
  return (
    <section className="table-card page-panel">
      <div className="section-heading">
        <PackageSearch size={20} />
        <div>
          <h2>Controlled Tool Inventory</h2>
          <p>Each record represents one physical tool assigned to an NFC UID.</p>
        </div>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Tool</th>
              <th>Code</th>
              <th>UID</th>
              <th>Status</th>
              <th>Reason</th>
              <th>Borrower</th>
              <th>Borrowed At</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((tool) => (
              <tr key={tool.uid}>
                <td><button className="tool-cell tool-link" onClick={() => onOpenTool(tool)} type="button"><ToolThumbnail imageUrl={tool.image_url} name={tool.tool_name} size="small" />{tool.tool_name}</button></td>
                <td>{tool.tool_code}</td>
                <td className="mono">{tool.uid}</td>
                <td><StatusBadge reason={tool.availability_reason} status={tool.status} />{isOverdueTool(tool, overdueDays) && <span className="overdue-badge">Overdue</span>}</td>
                <td>{tool.availability_reason || "-"}</td>
                <td>{tool.current_borrower || "-"}</td>
                <td>{formatDate(tool.borrowed_at)}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td className="empty-cell" colSpan="7"><EmptyState message="No tools have been registered yet." /></td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function InventoryManager({
  deletingUid,
  inventoryMessage,
  masterScanActive,
  masterScanBusy,
  newTool,
  onAddTool,
  onDeleteTool,
  onEditTool,
  onOpenTool,
  overdueDays,
  onStartMasterScan,
  onStopMasterScan,
  onSelectImage,
  onUpdateNewTool,
  rows,
  savingTool
}) {
  return (
    <section className="table-card page-panel">
      <div className="section-heading">
        <PackageCheck size={20} />
        <div>
          <h2>Inventory Master Data</h2>
          <p>Maintain registered tools, real NFC UIDs, and workshop tool codes.</p>
        </div>
      </div>

      <form className="inventory-form" onSubmit={onAddTool}>
        <label>
          UID
          <input
            value={newTool.uid}
            onChange={(event) => onUpdateNewTool("uid", event.target.value)}
            placeholder="Example: F9D99729"
          />
        </label>
        <button className="secondary-button" onClick={masterScanActive ? onStopMasterScan : onStartMasterScan} type="button">
          <ScanLine size={16} />
          {masterScanActive ? (masterScanBusy ? "Checking Scan..." : "Cancel UID Scan") : "Scan New Item UID"}
        </button>
        <label>
          Tool Name
          <input
            value={newTool.toolName}
            onChange={(event) => onUpdateNewTool("toolName", event.target.value)}
            placeholder="Example: Screwdriver"
          />
        </label>
        <label>
          Tool Code
          <input
            value={newTool.toolCode}
            onChange={(event) => onUpdateNewTool("toolCode", event.target.value)}
            placeholder="Example: TOOL002-05"
          />
        </label>
        <label>
          Status
          <select
            value={newTool.status}
            onChange={(event) => onUpdateNewTool("status", event.target.value)}
          >
            {STATUS_OPTIONS.map((status) => (
              <option key={status} value={status}>{status}</option>
            ))}
          </select>
        </label>
        <label>
          Tool Photo
          <input accept="image/*" onChange={(event) => onSelectImage(event.target.files?.[0])} type="file" />
        </label>
        <button className="complete-button" disabled={savingTool} type="submit">
          <BadgePlus size={18} />
          {savingTool ? "Adding..." : "Add Tool"}
        </button>
      </form>

      {inventoryMessage && <p className="helper-text">{inventoryMessage}</p>}
      {newTool.imageUrl && <div className="image-preview"><ToolThumbnail imageUrl={newTool.imageUrl} name={newTool.toolName} /><span>Photo selected for this new tool</span></div>}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Tool</th>
              <th>Code</th>
              <th>UID</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((tool) => (
              <tr key={`manage-${tool.uid}`}>
                <td><button className="tool-cell tool-link" onClick={() => onOpenTool(tool)} type="button"><ToolThumbnail imageUrl={tool.image_url} name={tool.tool_name} size="small" />{tool.tool_name}</button></td>
                <td>{tool.tool_code}</td>
                <td className="mono">{tool.uid}</td>
                <td><StatusBadge reason={tool.availability_reason} status={tool.status} />{isOverdueTool(tool, overdueDays) && <span className="overdue-badge">Overdue</span>}</td>
                <td>
                  <div className="row-actions">
                    <button
                      className="edit-button"
                      onClick={() => onEditTool(tool)}
                      type="button"
                    >
                      <Pencil size={16} />
                      Edit
                    </button>
                    <button
                      className="delete-button"
                      disabled={tool.status !== "Available" || deletingUid === tool.uid}
                      onClick={() => onDeleteTool(tool)}
                      type="button"
                    >
                      <Trash2 size={16} />
                      {deletingUid === tool.uid ? "Deleting..." : "Delete"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td className="empty-cell" colSpan="5"><EmptyState message="No master-data tools yet." factIndex={1} /></td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function HistoryPage({ historyRows, inventory, onOpenTool, overdueDays, todayList }) {
  const toolsByUid = new Map(inventory.map((tool) => [tool.uid, tool]));
  return (
    <section className="table-card page-panel">
      <div className="section-heading">
        <ClipboardList size={20} />
        <div>
          <h2>Borrow & Return History</h2>
          <p>Operational movement records from checkout and return workflows.</p>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Borrower</th>
              <th>Tool</th>
              <th>Tool UID</th>
              <th>Action</th>
              <th>Session</th>
            </tr>
          </thead>
          <tbody>
            {historyRows.map((row) => {
              const tool = toolsByUid.get(row.tool_uid);
              return <tr key={row.id}>
                <td>{formatDate(row.created_at)}</td>
                <td>{row.borrower_name}</td>
                <td><button className="tool-link" onClick={() => tool && onOpenTool(tool)} type="button"><ToolThumbnail imageUrl={tool?.image_url} name={tool?.tool_name} size="small" /></button></td>
                <td className="mono">{row.tool_uid}</td>
                <td>{row.action}{row.action === "Borrowed" && tool && isOverdueTool(tool, overdueDays) && <span className="overdue-badge">Overdue</span>}</td>
                <td>{row.session_id || "-"}</td>
              </tr>;
            })}
            {historyRows.length === 0 && (
              <tr>
                <td colSpan="6" className="empty-cell"><EmptyState message="No borrow or return records yet." factIndex={2} /></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="history-today">
        <h3>Today&apos;s Quick Log</h3>
        <div className="activity-list">
          {todayList.slice(0, 8).map((item) => (
            <div className="activity-row" key={`${item.created_at}-${item.tool_code}`}>
              <span className="activity-time">{formatDate(item.created_at)}</span>
              <strong>{item.borrower_name}</strong>
              <span>{item.tool_name} {item.tool_code}</span>
              <span className="activity-action">{item.action}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function SettingsPage({
  appSettings,
  lastScanAt,
  onExportHistory,
  onRefreshData,
  onSaveSettings,
  overdueTools,
  scannerActive,
  scannerConnection,
  scannerDisconnected,
  supabaseConfigured,
  totalTools,
  unserviceableCount
}) {
  const [draft, setDraft] = useState(appSettings);

  function updateDraft(field, value) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function save(event) {
    event.preventDefault();
    onSaveSettings(draft);
  }

  const scannerStatus = scannerDisconnected
    ? "Connection problem"
    : scannerActive
      ? "Listening for NFC scans"
      : "Standby";

  return (
    <section className="table-card page-panel">
      <div className="section-heading">
        <ShieldCheck size={20} />
        <div>
          <h2>System Settings</h2>
          <p>Device details, controls, alerts, and local administrator preferences.</p>
        </div>
      </div>
      <form className="settings-form" onSubmit={save}>
        <div className="settings-grid">
          <article className="settings-card">
            <div className="settings-card-heading"><Bluetooth size={18} /><strong>Scanner & Bluetooth Bridge</strong></div>
            <label>ESP32 device ID<input value={draft.scannerDeviceId} onChange={(event) => updateDraft("scannerDeviceId", event.target.value)} /></label>
            <label>Bridge note<input value={draft.scannerNetworkLabel} onChange={(event) => updateDraft("scannerNetworkLabel", event.target.value)} /></label>
            <p className="helper-text">Checkout scanner: <strong>{scannerStatus}</strong><br />Last scan: {lastScanAt ? formatDate(lastScanAt) : "No scans in this browser session"}</p>
          </article>

          <article className="settings-card">
            <div className="settings-card-heading"><Bluetooth size={18} /><strong>ESP32 Bluetooth Status</strong></div>
            {!scannerConnection.configured ? (
              <p className="helper-text">{scannerConnection.error || "Install the scanner-status SQL to enable online detection."}</p>
            ) : (
              <p className="helper-text">ESP32: <strong>{scannerConnection.online ? "Online" : "Offline"}</strong><br />{scannerConnection.lastSeen ? `Last Bluetooth heartbeat: ${formatDate(scannerConnection.lastSeen)}` : "No Bluetooth heartbeat received yet."}</p>
            )}
            <p className="helper-text">Online means the laptop bridge received an ESP32 Bluetooth heartbeat within the last 25 seconds.</p>
          </article>

          <article className="settings-card">
            <div className="settings-card-heading"><ShieldCheck size={18} /><strong>Admin Security</strong></div>
            <label>Master Data PIN<input type="password" value={draft.adminPin} onChange={(event) => updateDraft("adminPin", event.target.value)} placeholder="Uses .env PIN when left blank" /></label>
            <p className="helper-text">Master Data locks when you leave it and requires this PIN every time you reopen it.</p>
          </article>

          <article className="settings-card">
            <div className="settings-card-heading"><Wrench size={18} /><strong>Workshop Details</strong></div>
            <label>Workshop name<input value={draft.workshopName} onChange={(event) => updateDraft("workshopName", event.target.value)} /></label>
            <p className="helper-text">Used for newly created tools and new borrow sessions.</p>
          </article>

          <article className="settings-card">
            <div className="settings-card-heading"><AlertTriangle size={18} /><strong>Alert Rules</strong></div>
            <label>Overdue after (days)<input min="1" type="number" value={draft.overdueDays} onChange={(event) => updateDraft("overdueDays", event.target.value)} /></label>
            <label className="checkbox-row"><input checked={draft.fodAlertEnabled} onChange={(event) => updateDraft("fodAlertEnabled", event.target.checked)} type="checkbox" /> Enable FOD-risk reminders</label>
            <p className="helper-text">{draft.fodAlertEnabled ? `${overdueTools.length} overdue borrowed tool(s) need attention.` : "FOD-risk reminders are disabled."}</p>
          </article>

          <article className="settings-card">
            <div className="settings-card-heading"><Database size={18} /><strong>Data Maintenance</strong></div>
            <p className="helper-text">Refresh live Supabase data or save the full borrow/return log as a CSV file.</p>
            <div className="settings-actions">
              <button className="secondary-button" onClick={onRefreshData} type="button"><RefreshCw size={16} /> Refresh data</button>
              <button className="secondary-button" onClick={onExportHistory} type="button"><ClipboardList size={16} /> Export history</button>
            </div>
          </article>

          <article className="settings-card">
            <div className="settings-card-heading"><Activity size={18} /><strong>System Information</strong></div>
            <dl>
              <div><dt>Database</dt><dd>{supabaseConfigured ? "Supabase configured" : "Not configured"}</dd></div>
              <div><dt>Registered tools</dt><dd>{totalTools}</dd></div>
              <div><dt>Unserviceable</dt><dd>{unserviceableCount}</dd></div>
              <div><dt>NFC data rule</dt><dd>UID only</dd></div>
            </dl>
          </article>
        </div>
        <div className="settings-save-row"><button className="complete-button" type="submit"><Check size={18} /> Save settings</button><span>These preferences are stored only in this browser.</span></div>
      </form>
    </section>
  );
}

function ManualToolPicker({ onCancel, onSelect, rows }) {
  const [query, setQuery] = useState("");
  const visibleTools = rows.filter((tool) => {
    const searchText = `${tool.tool_name} ${tool.tool_code}`.toLowerCase();
    return searchText.includes(query.trim().toLowerCase());
  });

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="manual-tool-title">
        <div className="modal-header">
          <div>
            <p className="eyebrow">Scanner Backup</p>
            <h2 id="manual-tool-title">Select Tool Manually</h2>
          </div>
          <button className="modal-close" onClick={onCancel} type="button" aria-label="Close manual tool selection"><X size={18} /></button>
        </div>
        <p className="helper-text">Use this only when the NFC scanner is unavailable. Select an available tool to add it to this issue record.</p>
        <label className="manual-tool-search">Search tool name or code<input autoFocus onChange={(event) => setQuery(event.target.value)} placeholder="Example: Screwdriver or TOOL002" value={query} /></label>
        <div className="manual-tool-list">
          {visibleTools.length === 0 && <p className="empty">No available tools match your search.</p>}
          {visibleTools.map((tool) => (
            <button className="manual-tool-row" key={tool.uid} onClick={() => onSelect(tool)} type="button">
              <span><strong>{tool.tool_name}</strong><small>{tool.tool_code}</small></span>
              <BadgePlus size={18} />
            </button>
          ))}
        </div>
        <div className="modal-actions"><button className="secondary-button" onClick={onCancel} type="button">Cancel</button></div>
      </section>
    </div>
  );
}

function CheckoutConfirmModal({ checkout, checkoutItems, checkoutSaving, onCancel, onConfirm }) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="checkout-confirm-title">
        <div className="modal-header">
          <div>
            <p className="eyebrow">Staff Verification</p>
            <h2 id="checkout-confirm-title">Confirm Checkout</h2>
          </div>
          <button className="modal-close" onClick={onCancel} type="button" aria-label="Close confirmation">
            <X size={18} />
          </button>
        </div>

        <div className="confirm-grid">
          <div>
            <span>Student Name</span>
            <strong>{checkout.studentName}</strong>
          </div>
          <div>
            <span>Student ID</span>
            <strong>{checkout.studentId}</strong>
          </div>
          <div>
            <span>Staff Name</span>
            <strong>{checkout.staffName}</strong>
          </div>
        </div>

        <div className="modal-tool-list">
          {checkoutItems.map((item) => (
            <article key={`confirm-${item.uid}`}>
              <ToolThumbnail imageUrl={item.image_url} name={item.tool_name} size="small" />
              <div><strong>{item.tool_name}</strong><span>{item.tool_code} | UID {item.uid}</span></div>
            </article>
          ))}
        </div>

        <div className="modal-actions">
          <button className="secondary-button" onClick={onCancel} type="button">
            Cancel
          </button>
          <button className="complete-button" disabled={checkoutSaving} onClick={onConfirm} type="button">
            <Check size={18} />
            {checkoutSaving ? "Confirming..." : "Confirm Checkout"}
          </button>
        </div>
      </section>
    </div>
  );
}

function ToolDetailModal({ historyRows, loading, onClose, overdue, tool }) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal-card tool-detail-modal" role="dialog" aria-modal="true" aria-labelledby="tool-detail-title">
        <div className="modal-header">
          <div>
            <p className="eyebrow">Tool Detail</p>
            <h2 id="tool-detail-title">{tool.tool_name}</h2>
          </div>
          <button className="modal-close" onClick={onClose} type="button" aria-label="Close tool detail"><X size={18} /></button>
        </div>
        <div className="tool-detail-summary">
          <ToolThumbnail imageUrl={tool.image_url} name={tool.tool_name} />
          <div>
            <p className="tool-code">{tool.tool_code}</p>
            <p className="mono">UID {tool.uid}</p>
            <StatusBadge reason={tool.availability_reason} status={tool.status} />
            {overdue && <span className="overdue-badge">Overdue return</span>}
          </div>
        </div>
        <dl className="tool-detail-data">
          <div><dt>Current borrower</dt><dd>{tool.current_borrower || "No active borrower"}</dd></div>
          <div><dt>Borrowed at</dt><dd>{formatDate(tool.borrowed_at)}</dd></div>
          <div><dt>Workshop</dt><dd>{tool.workshop || "Not recorded"}</dd></div>
        </dl>
        <div className="detail-history">
          <h3>Tool Movement History</h3>
          {loading && <p className="helper-text">Loading tool history…</p>}
          {!loading && historyRows.length === 0 && <EmptyState message="No movement history for this tool." factIndex={1} />}
          {!loading && historyRows.map((row) => (
            <div className="detail-history-row" key={row.id}>
              <span className={row.action === "Returned" ? "return-dot" : "borrow-dot"} />
              <div><strong>{row.action}</strong><span>{row.borrower_name || "Unknown borrower"} · {formatDate(row.returned_at || row.borrowed_at || row.created_at)}</span></div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function EditToolModal({ editMessage, editTool, onCancel, onSave, onSelectImage, onUpdate, savingEdit }) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="edit-tool-title">
        <div className="modal-header">
          <div>
            <p className="eyebrow">Inventory Control</p>
            <h2 id="edit-tool-title">Edit Tool</h2>
          </div>
          <button className="modal-close" onClick={onCancel} type="button" aria-label="Close edit tool">
            <X size={18} />
          </button>
        </div>

        <form className="edit-tool-form" onSubmit={onSave}>
          <label>
            Tool Name
            <input
              value={editTool.toolName}
              onChange={(event) => onUpdate("toolName", event.target.value)}
            />
          </label>
          <label>
            Tool Code
            <input
              value={editTool.toolCode}
              onChange={(event) => onUpdate("toolCode", event.target.value)}
            />
          </label>
          <label>
            UID
            <input
              value={editTool.uid}
              onChange={(event) => onUpdate("uid", event.target.value)}
            />
          </label>
          <label>
            Status
            <select
              value={editTool.status}
              onChange={(event) => onUpdate("status", event.target.value)}
            >
              {STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>{status}</option>
              ))}
            </select>
          </label>
          <label>
            Tool Photo
            <input accept="image/*" onChange={(event) => onSelectImage(event.target.files?.[0])} type="file" />
          </label>
          {editTool.imageUrl && <div className="image-preview"><ToolThumbnail imageUrl={editTool.imageUrl} name={editTool.toolName} /><span>Current tool photo</span></div>}

          {editMessage && <p className="helper-text">{editMessage}</p>}

          <div className="modal-actions">
            <button className="secondary-button" onClick={onCancel} type="button">
              Cancel
            </button>
            <button className="complete-button" disabled={savingEdit} type="submit">
              <Check size={18} />
              {savingEdit ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function ToastStack({ toasts }) {
  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map((toast) => (
        <div className={`toast ${toast.type}`} key={toast.id}>
          {toast.message}
        </div>
      ))}
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
