// ============================================================
//  Asset IT v2 — Supabase Edition
//  Modern redesign with full Supabase integration
// ============================================================

import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const App = {
  // ── State ────────────────────────────────────────────────
  currentUser: null,
  assets: [],
  departments: [],
  filteredAssets: [],
  currentPage: 1,
  itemsPerPage: 15,
  db: null,
  realtimeChannel: null,
  charts: { status: null, type: null, dept: null },
  dataLoaded: false,

  // ── Supabase Config ──────────────────────────────────────
  // TODO: ใส่ค่าจาก Supabase Dashboard → Settings → API
  supabaseUrl: "https://afftspqsbojqvjidpidz.supabase.co",
  supabaseKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFmZnRzcHFzYm9qcXZqaWRwaWR6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzMDQ2OTQsImV4cCI6MjA4OTg4MDY5NH0.Rpyz7l7YQjm5wNsBMiKwotozMgLIoWGdrPGE2lD8RoM",

  // ── Constants ────────────────────────────────────────────
  assetTypes: {
    PC: "คอมพิวเตอร์ตั้งโต๊ะ", NB: "โน้ตบุ๊ก", KB: "คีย์บอร์ด",
    MU: "เมาส์", MT: "จอภาพ", PH: "โทรศัพท์", PT: "เครื่องพิมพ์",
    AF: "เครื่องฟอกอากาศ", CAM: "กล้อง", EP: "หูฟัง",
    LT: "ไฟ", MIC: "ไมโครโฟน", OT: "อื่นๆ",
  },
  // reverse map: ชื่อไทย → code (for import)
  get typeByName() {
    const m = {};
    for (const [k, v] of Object.entries(this.assetTypes)) m[v] = k;
    return m;
  },
  assetStatuses: ["ปกติ", "สำรอง", "เสีย", "หาไม่เจอ", "รออนุมัติ"],
  statusBadgeClass: {
    ปกติ: "badge-ok", สำรอง: "badge-reserve",
    เสีย: "badge-broken", หาไม่เจอ: "badge-lost", รออนุมัติ: "badge-pending",
  },

  // ── Init ─────────────────────────────────────────────────
  async init() {
    this.showLoader();
    try {
      this.db = createClient(this.supabaseUrl, this.supabaseKey);
    } catch (e) {
      console.error("Supabase Error:", e);
      this.toast("การเชื่อมต่อ Supabase ล้มเหลว", "error");
    }

    this.bindEvents();

    try {
      await this.loadDepartments();
    } catch (e) {
      console.error("Load Depts Error:", e);
    }

    this.populateDropdowns();
    this.hideLoader();
  },

  bindEvents() {
    // login
    document.getElementById("loginForm").addEventListener("submit", (e) => {
      e.preventDefault(); this.login();
    });
    // asset form
    document.getElementById("assetForm").addEventListener("submit", (e) => {
      e.preventDefault(); this.saveAsset();
    });
    document.getElementById("fType").addEventListener("change", () => this.generateId());
    document.getElementById("fPurchaseDate").addEventListener("change", (e) => {
      document.getElementById("fLifespan").value = this.calcAge(e.target.value);
    });
    // dept form
    document.getElementById("deptForm").addEventListener("submit", (e) => {
      e.preventDefault(); this.addDept();
    });
    // filters
    ["filterSearch", "filterDept", "filterStatus", "filterType"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener(id === "filterSearch" ? "input" : "change", () => this.applyFilter());
    });
    // pagination
    document.getElementById("prevBtn").addEventListener("click", () => this.prevPage());
    document.getElementById("nextBtn").addEventListener("click", () => this.nextPage());
  },

  // ── Auth ─────────────────────────────────────────────────
  async login() {
    const dept = document.getElementById("loginDept").value;
    const pw = document.getElementById("loginPw").value.trim();
    if (!dept) { this.toast("กรุณาเลือกแผนก", "error"); return; }
    const isIT = dept === "IT";
    if (pw !== (isIT ? "admin123" : "123456")) {
      this.toast("รหัสผ่านไม่ถูกต้อง", "error"); return;
    }
    this.currentUser = { department: dept, isIT };
    document.getElementById("loginBackdrop").classList.add("hidden");
    document.getElementById("appShell").style.display = "";
    this.setupUIForUser();
    this.subscribeRealtime();
    await this.loadData();
  },

  logout() {
    if (this.realtimeChannel) this.db.removeChannel(this.realtimeChannel);
    this.currentUser = null;
    this.assets = []; this.filteredAssets = []; this.dataLoaded = false;
    document.getElementById("appShell").style.display = "none";
    document.getElementById("loginBackdrop").classList.remove("hidden");
    document.getElementById("loginPw").value = "";
    // destroy charts
    Object.keys(this.charts).forEach((k) => { if (this.charts[k]) { this.charts[k].destroy(); this.charts[k] = null; } });
  },

  setupUIForUser() {
    const { department, isIT } = this.currentUser;
    const initials = department.slice(0, 2).toUpperCase();
    document.getElementById("sidebarAvatar").textContent = initials;
    document.getElementById("sidebarName").textContent = department;
    document.getElementById("sidebarRole").textContent = isIT ? "ผู้ดูแลระบบ" : "ผู้ใช้งาน";
    // IT-only nav
    document.getElementById("navDepts").classList.toggle("hidden", !isIT);
    // dept filter lock
    if (!isIT) {
      const df = document.getElementById("filterDept");
      df.value = department; df.disabled = true;
    }
    this.renderTopActions();
  },

  renderTopActions() {
    const el = document.getElementById("topActions");
    if (!this.currentUser) { el.innerHTML = ""; return; }
    const isIT = this.currentUser.isIT;
    el.innerHTML = `
      <button class="btn btn-primary btn-sm" onclick="App.showAddAsset()">
        <i class="fas fa-plus"></i> เพิ่มทรัพย์สิน
      </button>
      ${isIT ? `
      <button class="btn btn-ghost btn-sm" onclick="App.importExcel()" title="นำเข้า Excel">
        <i class="fas fa-file-import"></i>
      </button>
      <button class="btn btn-ghost btn-sm" onclick="App.exportExcel()" title="ส่งออก Excel">
        <i class="fas fa-file-export"></i>
      </button>` : ""}
    `;
  },

  // ── Data ─────────────────────────────────────────────────
  async loadDepartments() {
    try {
      const { data, error } = await this.db.from("departments").select("name").order("name");
      if (error) throw error;
      
      if (!data || data.length === 0) {
        const { error: insErr } = await this.db.from("departments").insert({ name: "IT" });
        if (insErr) throw insErr;
        this.departments = ["IT"];
      } else {
        this.departments = data.map((d) => d.name);
      }
    } catch (e) {
      console.warn("Could not load departments from DB, using fallback", e);
      this.departments = ["IT"]; // Fallback เพื่อให้เข้าสู่ระบบได้
    }
  },

  async loadData() {
    this.showLoader();
    try {
      const { data, error } = await this.db.from("assets").select("*").order("id");
      if (error) throw error;
      this.assets = data || [];
      this.dataLoaded = true;
      this.showPage("dashboard");
    } catch (e) {
      this.toast("โหลดข้อมูลล้มเหลว: " + e.message, "error");
      this.showPage("dashboard");
    } finally {
      this.hideLoader();
    }
  },

  subscribeRealtime() {
    if (this.realtimeChannel) this.db.removeChannel(this.realtimeChannel);
    this.realtimeChannel = this.db
      .channel("assets-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "assets" }, async () => {
        const { data } = await this.db.from("assets").select("*").order("id");
        this.assets = data || [];
        this.refreshCurrentPage();
        this.updateNotifications();
      })
      .subscribe();
  },

  refreshCurrentPage() {
    const pages = {
      dashboard: () => this.renderDashboard(),
      assetList: () => this.applyFilter(),
    };
    const active = document.querySelector(".page.active");
    if (!active) return;
    if (active.id === "pageDashboard") this.renderDashboard();
    else if (active.id === "pageAssetList") this.applyFilter();
  },

  // ── Routing ───────────────────────────────────────────────
  showPage(name) {
    const map = {
      dashboard: "pageDashboard",
      assetList: "pageAssetList",
      assetForm: "pageAssetForm",
      departments: "pageDepartments",
    };
    const titleMap = {
      dashboard: "แดชบอร์ด",
      assetList: "รายการทรัพย์สิน",
      assetForm: document.getElementById("formTitle")?.textContent || "จัดการทรัพย์สิน",
      departments: "จัดการแผนก",
    };
    Object.values(map).forEach((id) => {
      document.getElementById(id)?.classList.remove("active");
    });
    document.getElementById(map[name])?.classList.add("active");
    document.getElementById("topbarTitle").textContent = titleMap[name] || "";
    // nav active
    document.querySelectorAll(".nav-item").forEach((el) => el.classList.remove("active"));
    const navMap = { dashboard: "navDashboard", assetList: "navAssets", departments: "navDepts" };
    if (navMap[name]) document.getElementById(navMap[name])?.classList.add("active");
    // global search visibility
    document.getElementById("globalSearchWrap").style.display = name === "assetList" ? "" : "none";

    if (name === "dashboard") this.renderDashboard();
    if (name === "assetList") { this.populateFilterDropdowns(); this.applyFilter(); }
    if (name === "departments") this.renderDeptList();
    this.closeSidebar();
  },

  // ── Dashboard ─────────────────────────────────────────────
  renderDashboard() {
    const data = this.currentUser?.isIT
      ? this.assets
      : this.assets.filter((a) => a.department === this.currentUser.department);

    document.getElementById("statTotal").textContent = data.length;
    document.getElementById("statOk").textContent = data.filter((a) => a.status === "ปกติ" && a.is_approved !== false).length;
    document.getElementById("statBroken").textContent = data.filter((a) => a.status === "เสีย" && a.is_approved !== false).length;
    document.getElementById("statReserve").textContent = data.filter((a) => a.status === "สำรอง" && a.is_approved !== false).length;
    document.getElementById("statLost").textContent = data.filter((a) => a.status === "หาไม่เจอ" && a.is_approved !== false).length;

    const pending = data.filter((a) => a.is_approved === false).length;
    const pCard = document.getElementById("statPendingCard");
    if (this.currentUser?.isIT && pending > 0) {
      pCard.classList.remove("hidden");
      document.getElementById("statPending").textContent = pending;
    } else {
      pCard.classList.add("hidden");
    }

    this.renderStatusChart(data);
    this.renderTypeChart(data);
    this.renderDeptChart(data);
    this.updateNotifications();
  },

  renderStatusChart(data) {
    const canvas = document.getElementById("chartStatus");
    if (!canvas) return;
    if (this.charts.status) this.charts.status.destroy();
    const counts = {};
    const colors = {
      ปกติ: "#3a9b8a", สำรอง: "#c68d3e", เสีย: "#d94f3d",
      หาไม่เจอ: "#8a8580", รออนุมัติ: "#e07a5f",
    };
    data.forEach((a) => {
      const k = a.is_approved === false ? "รออนุมัติ" : (a.status || "ไม่ระบุ");
      counts[k] = (counts[k] || 0) + 1;
    });
    this.charts.status = new Chart(canvas, {
      type: "doughnut",
      data: {
        labels: Object.keys(counts),
        datasets: [{
          data: Object.values(counts),
          backgroundColor: Object.keys(counts).map((k) => colors[k] || "#8a8580"),
          borderWidth: 0,
          hoverOffset: 6,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        cutout: "65%",
        plugins: {
          legend: { position: "right", labels: { padding: 14, font: { size: 12, family: "'DM Sans'" }, usePointStyle: true, pointStyleWidth: 8 } },
          tooltip: { callbacks: { label: (ctx) => ` ${ctx.label}: ${ctx.parsed} ชิ้น` } },
        },
      },
    });
  },

  renderTypeChart(data) {
    const canvas = document.getElementById("chartType");
    if (!canvas) return;
    if (this.charts.type) this.charts.type.destroy();
    const counts = {};
    data.forEach((a) => {
      const k = this.assetTypes[a.type] || a.type || "ไม่ระบุ";
      counts[k] = (counts[k] || 0) + 1;
    });
    // top 8
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8);
    const palette = ["#3a9b8a", "#e07a5f", "#c68d3e", "#7c6fa0", "#5c6b7a", "#3a9b6b", "#d94f3d", "#8a8580"];
    this.charts.type = new Chart(canvas, {
      type: "bar",
      data: {
        labels: sorted.map((s) => s[0]),
        datasets: [{
          data: sorted.map((s) => s[1]),
          backgroundColor: palette,
          borderRadius: 6,
          borderSkipped: false,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        indexAxis: "y",
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { color: "#f0ece6" }, ticks: { font: { size: 11 }, color: "#9b9389" } },
          y: { grid: { display: false }, ticks: { font: { size: 12 }, color: "#5c564f" } },
        },
      },
    });
  },

  renderDeptChart(data) {
    const canvas = document.getElementById("chartDept");
    if (!canvas) return;
    if (this.charts.dept) this.charts.dept.destroy();
    const counts = {};
    data.forEach((a) => { const k = a.department || "ไม่ระบุ"; counts[k] = (counts[k] || 0) + 1; });
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    this.charts.dept = new Chart(canvas, {
      type: "bar",
      data: {
        labels: sorted.map((s) => s[0]),
        datasets: [{
          data: sorted.map((s) => s[1]),
          backgroundColor: "#3a9b8a",
          hoverBackgroundColor: "#2a7a6b",
          borderRadius: 5,
          borderSkipped: false,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 11 }, color: "#5c564f", maxRotation: 35 } },
          y: { grid: { color: "#f0ece6" }, ticks: { font: { size: 11 }, color: "#9b9389", precision: 0 } },
        },
      },
    });
  },

  updateNotifications() {
    if (!this.currentUser?.isIT) return;
    const count = this.assets.filter((a) => a.is_approved === false).length;
    const badge = document.getElementById("pendingBadge");
    if (count > 0) { badge.textContent = count; badge.classList.remove("hidden"); }
    else badge.classList.add("hidden");
  },

  // ── Asset List ─────────────────────────────────────────────
  populateDropdowns() {
    // Login modal dept
    const loginDept = document.getElementById("loginDept");
    loginDept.innerHTML = "";
    this.departments.sort().forEach((d) => {
      loginDept.innerHTML += `<option value="${d}">${d}</option>`;
    });
    // form dept
    const fDept = document.getElementById("fDept");
    fDept.innerHTML = "";
    this.departments.sort().forEach((d) => {
      fDept.innerHTML += `<option value="${d}">${d}</option>`;
    });
    // form type
    const fType = document.getElementById("fType");
    fType.innerHTML = "";
    for (const [k, v] of Object.entries(this.assetTypes))
      fType.innerHTML += `<option value="${k}">${v}</option>`;
    // form status (no รออนุมัติ)
    const fStatus = document.getElementById("fStatus");
    fStatus.innerHTML = "";
    this.assetStatuses.filter((s) => s !== "รออนุมัติ").forEach((s) => {
      fStatus.innerHTML += `<option value="${s}">${s}</option>`;
    });
  },

  populateFilterDropdowns() {
    const fd = document.getElementById("filterDept");
    const savedVal = fd.value;
    fd.innerHTML = '<option value="all">ทุกแผนก</option>';
    this.departments.sort().forEach((d) => {
      fd.innerHTML += `<option value="${d}">${d}</option>`;
    });
    fd.value = savedVal || (this.currentUser?.isIT ? "all" : this.currentUser.department);
    if (!this.currentUser?.isIT) fd.disabled = true;

    const ft = document.getElementById("filterType");
    ft.innerHTML = '<option value="all">ทุกประเภท</option>';
    for (const [k, v] of Object.entries(this.assetTypes))
      ft.innerHTML += `<option value="${k}">${v}</option>`;
  },

  applyFilter() {
    const search = document.getElementById("filterSearch")?.value.toLowerCase() || "";
    const dept = document.getElementById("filterDept")?.value || "all";
    const status = document.getElementById("filterStatus")?.value || "all";
    const type = document.getElementById("filterType")?.value || "all";

    this.filteredAssets = this.assets.filter((a) => {
      if (!this.currentUser?.isIT && a.department !== this.currentUser.department) return false;
      if (search) {
        const hay = [a.id, a.name, a.username, a.nickname, a.department, a.serial].join(" ").toLowerCase();
        if (!hay.includes(search)) return false;
      }
      if (dept !== "all" && a.department !== dept) return false;
      if (status !== "all") {
        if (status === "รออนุมัติ") { if (a.is_approved !== false) return false; }
        else { if (String(a.status || "").trim() !== status || a.is_approved === false) return false; }
      }
      if (type !== "all" && a.type !== type) return false;
      return true;
    });

    // sort: pending first for IT
    if (this.currentUser?.isIT) {
      this.filteredAssets.sort((a, b) => {
        if (a.is_approved === false && b.is_approved !== false) return -1;
        if (a.is_approved !== false && b.is_approved === false) return 1;
        return 0;
      });
    }

    this.currentPage = 1;
    this.renderTable();
  },

  renderTable() {
    const tbody = document.getElementById("assetTableBody");
    const total = this.filteredAssets.length;
    const start = (this.currentPage - 1) * this.itemsPerPage;
    const slice = this.filteredAssets.slice(start, start + this.itemsPerPage);
    const end = Math.min(start + this.itemsPerPage, total);

    if (slice.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7">
        <div class="empty-state"><i class="fas fa-box-open"></i><p>ไม่พบข้อมูล</p></div>
      </td></tr>`;
    } else {
      tbody.innerHTML = slice.map((a) => this.rowHTML(a)).join("");
    }

    document.getElementById("paginationInfo").textContent =
      total > 0 ? `แสดง ${start + 1}–${end} จาก ${total} รายการ` : "ไม่พบข้อมูล";
    document.getElementById("prevBtn").disabled = this.currentPage === 1;
    document.getElementById("nextBtn").disabled = end >= total;
  },

  rowHTML(a) {
    const isPending = a.is_approved === false;
    const statusKey = isPending ? "รออนุมัติ" : (a.status || "หาไม่เจอ");
    const badgeCls = this.statusBadgeClass[statusKey] || "badge-lost";
    const typeName = this.assetTypes[a.type] || a.type || "ไม่ระบุ";
    const isIT = this.currentUser?.isIT;

    let actions = `
      <button class="btn-icon btn-icon-view" onclick="App.showDetail('${a.id}')" title="รายละเอียด"><i class="fas fa-eye"></i></button>
      <button class="btn-icon btn-icon-edit" onclick="App.showEditAsset('${a.id}')" title="แก้ไข"><i class="fas fa-pen"></i></button>
    `;
    if (isIT) {
      if (isPending) actions += `<button class="btn-icon btn-icon-approve" onclick="App.approveAsset('${a.id}')" title="อนุมัติ"><i class="fas fa-check"></i></button>`;
      actions += `<button class="btn-icon btn-icon-delete" onclick="App.deleteAsset('${a.id}')" title="ลบ"><i class="fas fa-trash"></i></button>`;
    }

    return `<tr>
      <td data-label="ID">${a.id || "-"}</td>
      <td data-label="ชื่อทรัพย์สิน"><strong>${a.name || "-"}</strong></td>
      <td data-label="ผู้ใช้" class="muted">${a.nickname || a.username || "-"}</td>
      <td data-label="แผนก" class="muted">${a.department || "-"}</td>
      <td data-label="ประเภท"><span class="badge badge-type">${typeName}</span></td>
      <td data-label="สถานะ"><span class="badge ${badgeCls}">${statusKey}</span></td>
      <td><div class="action-btns">${actions}</div></td>
    </tr>`;
  },

  prevPage() { if (this.currentPage > 1) { this.currentPage--; this.renderTable(); } },
  nextPage() {
    const max = Math.ceil(this.filteredAssets.length / this.itemsPerPage);
    if (this.currentPage < max) { this.currentPage++; this.renderTable(); }
  },

  // ── Asset CRUD ────────────────────────────────────────────
  showAddAsset() {
    document.getElementById("formTitle").textContent = "เพิ่มทรัพย์สินใหม่";
    document.getElementById("assetForm").reset();
    document.getElementById("fId").value = "";
    document.getElementById("fLifespan").value = "";
    this.setFormLock(this.currentUser?.isIT ? false : "new");
    if (!this.currentUser?.isIT) {
      document.getElementById("fDept").value = this.currentUser.department;
    }
    this.showPage("assetForm");
    this.generateId();
  },

  showEditAsset(id) {
    const a = this.assets.find((x) => x.id === id);
    if (!a) { this.toast("ไม่พบข้อมูล", "error"); return; }
    document.getElementById("formTitle").textContent = "แก้ไขทรัพย์สิน";
    document.getElementById("fId").value = a.id || "";
    document.getElementById("fName").value = a.name || "";
    document.getElementById("fUsername").value = a.username || "";
    document.getElementById("fNickname").value = a.nickname || "";
    document.getElementById("fType").value = a.type || "";
    document.getElementById("fSerial").value = a.serial || "";
    document.getElementById("fDept").value = a.department || "";
    document.getElementById("fPurchaseDate").value = a.purchase_date || "";
    document.getElementById("fPrice").value = a.price || "";
    document.getElementById("fWarranty").value = a.warranty_expiry || "";
    document.getElementById("fStatus").value = a.status || "ปกติ";
    document.getElementById("fLastCheck").value = a.last_check || "";
    document.getElementById("fSpecs").value = a.specs || "";
    document.getElementById("fNotes").value = a.notes || "";
    document.getElementById("fLifespan").value = this.calcAge(a.purchase_date);
    this.setFormLock(!this.currentUser?.isIT ? "edit" : false);
    this.showPage("assetForm");
  },

  setFormLock(mode) {
    // mode: false = all editable, 'new' = lock dept, 'edit' = lock dept+type+date
    const locks = {
      false: [],
      new: ["fDept"],
      edit: ["fDept", "fType", "fPurchaseDate"],
    };
    ["fDept", "fType", "fPurchaseDate"].forEach((id) => {
      const el = document.getElementById(id);
      const locked = (locks[mode] || []).includes(id);
      if (el.tagName === "SELECT") el.disabled = locked;
      else el.readOnly = locked;
      el.style.background = locked ? "var(--border-light)" : "";
    });
  },

  generateId() {
    if (document.getElementById("formTitle").textContent !== "เพิ่มทรัพย์สินใหม่") return;
    const type = document.getElementById("fType").value;
    if (!type) return;
    const same = this.assets.filter((a) => a.id?.startsWith(type + "-"));
    const max = same.length > 0 ? Math.max(...same.map((a) => parseInt(a.id.split("-")[1] || 0))) : 0;
    document.getElementById("fId").value = `${type}-${String(max + 1).padStart(3, "0")}`;
  },

  async saveAsset() {
    if (!this.currentUser) { this.toast("กรุณาเข้าสู่ระบบ", "error"); return; }
    const id = document.getElementById("fId").value.trim();
    if (!id) { this.toast("ไม่มีรหัสทรัพย์สิน", "error"); return; }

    const oldAsset = this.assets.find((a) => a.id === id);
    const isEditing = !!oldAsset;
    const isIT = this.currentUser.isIT;

    const payload = {
      id,
      name: document.getElementById("fName").value.trim(),
      username: document.getElementById("fUsername").value.trim(),
      nickname: document.getElementById("fNickname").value.trim(),
      serial: document.getElementById("fSerial").value.trim(),
      status: document.getElementById("fStatus").value,
      last_check: document.getElementById("fLastCheck").value || null,
      specs: document.getElementById("fSpecs").value.trim(),
      notes: document.getElementById("fNotes").value.trim(),
      price: document.getElementById("fPrice").value || null,
      warranty_expiry: document.getElementById("fWarranty").value || null,
    };

    if (isIT) {
      payload.type = document.getElementById("fType").value;
      payload.department = document.getElementById("fDept").value;
      payload.purchase_date = document.getElementById("fPurchaseDate").value || null;
      payload.is_approved = true;
    } else if (isEditing) {
      payload.type = oldAsset.type;
      payload.department = oldAsset.department;
      payload.purchase_date = oldAsset.purchase_date;
      payload.is_approved = oldAsset.is_approved;
    } else {
      payload.type = document.getElementById("fType").value;
      payload.department = this.currentUser.department;
      payload.purchase_date = document.getElementById("fPurchaseDate").value || null;
      payload.is_approved = false;
    }

    if (!payload.name || !payload.type || !payload.department || !payload.status) {
      this.toast("กรุณากรอกข้อมูลที่จำเป็น", "error"); return;
    }

    // usage history
    let history = (oldAsset?.usage_history) ? [...oldAsset.usage_history] : [];
    const now = new Date().toISOString();
    if (isEditing && (oldAsset.username || "") !== payload.username) {
      const activeIdx = history.findIndex((h) => !h.endDate);
      if (activeIdx !== -1) history[activeIdx].endDate = now;
      else if (oldAsset.username) history.push({ name: oldAsset.username, startDate: oldAsset.purchase_date || now, endDate: now });
      if (payload.username) history.push({ name: payload.username, startDate: now, endDate: null });
    } else if (!isEditing && payload.username) {
      history.push({ name: payload.username, startDate: now, endDate: null });
    }
    payload.usage_history = history;

    this.showLoader();
    const { error } = await this.db.from("assets").upsert(payload);
    this.hideLoader();
    if (error) { this.toast("บันทึกล้มเหลว: " + error.message, "error"); return; }
    let msg = "บันทึกสำเร็จ!";
    if (!isIT && !isEditing) msg += " (รอการอนุมัติจาก IT)";
    this.toast(msg, "success");
    this.showPage("assetList");
  },

  async approveAsset(id) {
    this.confirm("ยืนยันการอนุมัติ", `อนุมัติทรัพย์สิน ${id} หรือไม่?`, async () => {
      this.showLoader();
      const { error } = await this.db.from("assets").update({ is_approved: true }).eq("id", id);
      this.hideLoader();
      if (error) { this.toast("เกิดข้อผิดพลาด", "error"); return; }
      this.toast("อนุมัติสำเร็จ", "success");
    });
  },

  async deleteAsset(id) {
    if (!this.currentUser?.isIT) { this.toast("ไม่มีสิทธิ์ลบ", "error"); return; }
    this.confirm("ยืนยันการลบ", `ลบทรัพย์สิน "${id}" ? ไม่สามารถกู้คืนได้`, async () => {
      this.showLoader();
      const { error } = await this.db.from("assets").delete().eq("id", id);
      this.hideLoader();
      if (error) { this.toast("ลบล้มเหลว", "error"); return; }
      this.toast("ลบสำเร็จ", "success");
    });
  },

  // ── Detail Modal ──────────────────────────────────────────
  showDetail(id) {
    const a = this.assets.find((x) => x.id === id);
    if (!a) return;
    const isPending = a.is_approved === false;
    const statusKey = isPending ? "รออนุมัติ" : (a.status || "N/A");
    const badgeCls = this.statusBadgeClass[statusKey] || "badge-lost";

    const fields = [
      ["รหัส (ID)", a.id || "-"],
      ["ชื่อทรัพย์สิน", a.name || "-"],
      ["ผู้ใช้งาน", a.username || "-"],
      ["ชื่อเล่น", a.nickname || "-"],
      ["ประเภท", this.assetTypes[a.type] || a.type || "-"],
      ["Serial", a.serial || "-"],
      ["แผนก", a.department || "-"],
      ["วันที่ซื้อ", a.purchase_date || "-"],
      ["ราคา", a.price ? Number(a.price).toLocaleString() + " บาท" : "-"],
      ["อายุการใช้งาน", this.calcAge(a.purchase_date)],
      ["วันหมดประกัน", a.warranty_expiry || "-"],
      ["เช็คล่าสุด", a.last_check || "-"],
    ];
    const grid = document.getElementById("detailGrid");
    grid.innerHTML = fields.map(([label, val]) => `
      <div class="detail-item">
        <div class="detail-label">${label}</div>
        <div class="detail-value">${val}</div>
      </div>
    `).join("") + `
      <div class="detail-item">
        <div class="detail-label">สถานะ</div>
        <div><span class="badge ${badgeCls}">${statusKey}</span></div>
      </div>
      <div class="detail-item full">
        <div class="detail-label">สเปค</div>
        <div class="detail-box">${a.specs || "-"}</div>
      </div>
      <div class="detail-item full">
        <div class="detail-label">หมายเหตุ</div>
        <div class="detail-box">${a.notes || "-"}</div>
      </div>
    `;

    // History
    const hist = a.usage_history || [];
    const hl = document.getElementById("historyList");
    if (hist.length === 0) {
      hl.innerHTML = `<div class="history-item"><span style="color:var(--text-3);font-size:12px;">ไม่มีประวัติ</span></div>`;
    } else {
      hl.innerHTML = [...hist].reverse().map((h) => {
        const dot = h.endDate ? "past" : "active";
        const label = h.endDate
          ? `เคยใช้งาน · ${this.formatDate(h.endDate)}`
          : `<strong style="color:var(--success);">ใช้งานอยู่</strong>`;
        return `<div class="history-item">
          <div class="history-dot ${dot}"></div>
          <span>${h.name}</span>
          <span style="margin-left:auto;font-size:11px;color:var(--text-3);">${label}</span>
        </div>`;
      }).join("");
    }

    document.getElementById("detailBackdrop").classList.remove("hidden");
  },

  closeDetail() { document.getElementById("detailBackdrop").classList.add("hidden"); },

  // ── Departments ───────────────────────────────────────────
  renderDeptList() {
    const list = document.getElementById("deptList");
    if (this.departments.length === 0) {
      list.innerHTML = `<p style="padding:20px;text-align:center;color:var(--text-3);">ยังไม่มีแผนก</p>`;
      return;
    }
    const assetCount = {};
    this.assets.forEach((a) => { assetCount[a.department] = (assetCount[a.department] || 0) + 1; });
    list.innerHTML = [...this.departments].sort().map((d) => `
      <div class="dept-item">
        <div>
          <div class="dept-name">${d}</div>
          <div class="dept-count">${assetCount[d] || 0} รายการ</div>
        </div>
        <div style="display:flex;gap:8px;">
          <button class="btn-icon btn-icon-edit" onclick="App.editDept('${d}')" title="แก้ไข"><i class="fas fa-pen"></i></button>
          <button class="btn-icon btn-icon-delete" onclick="App.deleteDept('${d}')" title="ลบ"><i class="fas fa-trash"></i></button>
        </div>
      </div>
    `).join("");
  },

  async addDept() {
    const name = document.getElementById("newDeptName").value.trim();
    if (!name) return;
    if (this.departments.find((d) => d.toLowerCase() === name.toLowerCase())) {
      this.toast("มีแผนกนี้แล้ว", "error"); return;
    }
    const { error } = await this.db.from("departments").insert({ name });
    if (error) { this.toast("เกิดข้อผิดพลาด", "error"); return; }
    this.departments.push(name);
    this.departments.sort();
    this.populateDropdowns();
    this.renderDeptList();
    this.toast("เพิ่มแผนกสำเร็จ", "success");
    document.getElementById("newDeptName").value = "";
  },

  async editDept(oldName) {
    const newName = prompt(`แก้ไขชื่อแผนก "${oldName}":`, oldName);
    if (!newName?.trim() || newName.trim() === oldName) return;
    if (this.departments.find((d) => d.toLowerCase() === newName.trim().toLowerCase())) {
      this.toast("มีแผนกชื่อนี้แล้ว", "error"); return;
    }
    this.showLoader();
    const [r1, r2] = await Promise.all([
      this.db.from("assets").update({ department: newName.trim() }).eq("department", oldName),
      this.db.from("departments").update({ name: newName.trim() }).eq("name", oldName),
    ]);
    this.hideLoader();
    if (r1.error || r2.error) { this.toast("เกิดข้อผิดพลาด", "error"); return; }
    this.departments = this.departments.map((d) => d === oldName ? newName.trim() : d);
    this.assets = this.assets.map((a) => a.department === oldName ? { ...a, department: newName.trim() } : a);
    this.populateDropdowns();
    this.renderDeptList();
    this.toast("แก้ไขสำเร็จ", "success");
  },

  async deleteDept(name) {
    if (this.assets.some((a) => a.department === name)) {
      this.toast("ไม่สามารถลบได้ ยังมีทรัพย์สินในแผนกนี้", "error"); return;
    }
    this.confirm("ยืนยันการลบ", `ลบแผนก "${name}" ?`, async () => {
      const { error } = await this.db.from("departments").delete().eq("name", name);
      if (error) { this.toast("ลบล้มเหลว", "error"); return; }
      this.departments = this.departments.filter((d) => d !== name);
      this.populateDropdowns();
      this.renderDeptList();
      this.toast("ลบแผนกสำเร็จ", "success");
    });
  },

  // ── Excel Import / Export ─────────────────────────────────
  exportExcel() {
    if (!this.assets.length) { this.toast("ไม่มีข้อมูล", "error"); return; }
    const rows = this.assets.map((a) => ({
      ID: a.id, ชื่อทรัพย์สิน: a.name, ผู้ใช้งาน: a.username || "",
      ชื่อเล่น: a.nickname || "",
      ประเภท: this.assetTypes[a.type] || a.type,
      "Serial Number": a.serial || "",
      แผนก: a.department,
      วันที่ซื้อ: a.purchase_date || "",
      ราคา: a.price || "",
      อายุการใช้งาน: this.calcAge(a.purchase_date),
      วันหมดประกัน: a.warranty_expiry || "",
      สถานะ: a.is_approved === false ? "รออนุมัติ" : a.status,
      เช็คล่าสุด: a.last_check || "",
      สเปค: a.specs || "",
      หมายเหตุ: a.notes || "",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Assets");
    XLSX.writeFile(wb, "Assets_Data.xlsx");
    this.toast("กำลังดาวน์โหลด...", "success");
  },

  importExcel() {
    const inp = document.createElement("input");
    inp.type = "file"; inp.accept = ".xlsx,.xls";
    inp.addEventListener("change", async (e) => {
      const file = e.target.files[0]; if (!file) return;
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json(ws);
      const typeByName = this.typeByName;
      const rows = json.filter((r) => r.ID).map((r) => ({
        id: r.ID, name: r["ชื่อทรัพย์สิน"] || "", username: r["ผู้ใช้งาน"] || "",
        nickname: r["ชื่อเล่น"] || "",
        type: typeByName[r["ประเภท"]] || r["ประเภท"] || "OT",
        serial: r["Serial Number"] || "",
        department: r["แผนก"] || "IT",
        purchase_date: r["วันที่ซื้อ"] || null,
        price: r["ราคา"] || null,
        warranty_expiry: r["วันหมดประกัน"] || null,
        status: r["สถานะ"] || "ปกติ",
        last_check: r["เช็คล่าสุด"] || null,
        specs: r["สเปค"] || "", notes: r["หมายเหตุ"] || "",
        is_approved: true, usage_history: [],
      }));
      this.showLoader();
      const { error } = await this.db.from("assets").upsert(rows);
      this.hideLoader();
      if (error) { this.toast("นำเข้าล้มเหลว: " + error.message, "error"); return; }
      this.toast(`นำเข้าสำเร็จ ${rows.length} รายการ`, "success");
      await this.loadData();
    });
    inp.click();
  },

  // ── Utilities ─────────────────────────────────────────────
  calcAge(dateStr) {
    if (!dateStr) return "-";
    const start = new Date(dateStr); const end = new Date();
    if (isNaN(start)) return "-";
    let y = end.getFullYear() - start.getFullYear();
    let m = end.getMonth() - start.getMonth();
    let d = end.getDate() - start.getDate();
    if (d < 0) { m--; d += new Date(end.getFullYear(), end.getMonth(), 0).getDate(); }
    if (m < 0) { y--; m += 12; }
    if (y < 0) return "ยังไม่เริ่มใช้งาน";
    const p = [];
    if (y) p.push(`${y} ปี`); if (m) p.push(`${m} เดือน`);
    if (d && !y) p.push(`${d} วัน`);
    return p.join(" ") || "วันนี้";
  },

  formatDate(iso) {
    if (!iso) return "-";
    return new Date(iso).toLocaleDateString("th-TH", { year: "numeric", month: "short", day: "numeric" });
  },

  showLoader() { document.getElementById("loader").classList.remove("hidden"); },
  hideLoader() { document.getElementById("loader").classList.add("hidden"); },

  toast(msg, type = "info") {
    const c = document.getElementById("toastContainer");
    const t = document.createElement("div");
    const icon = { success: "fa-circle-check", error: "fa-circle-xmark", info: "fa-circle-info" }[type] || "fa-circle-info";
    t.className = `toast toast-${type}`;
    t.innerHTML = `<i class="fas ${icon}"></i> ${msg}`;
    c.appendChild(t);
    setTimeout(() => t.remove(), 4000);
  },

  confirm(title, msg, onOk) {
    document.getElementById("confirmTitle").textContent = title;
    document.getElementById("confirmMsg").textContent = msg;
    document.getElementById("confirmBackdrop").classList.remove("hidden");
    const ok = document.getElementById("confirmOk");
    const cancel = document.getElementById("confirmCancel");
    const newOk = ok.cloneNode(true); ok.parentNode.replaceChild(newOk, ok);
    const newCxl = cancel.cloneNode(true); cancel.parentNode.replaceChild(newCxl, cancel);
    const close = () => document.getElementById("confirmBackdrop").classList.add("hidden");
    newOk.addEventListener("click", () => { onOk(); close(); });
    newCxl.addEventListener("click", close);
  },

  toggleSidebar() {
    document.getElementById("sidebar").classList.toggle("open");
    document.getElementById("sidebarOverlay").classList.toggle("open");
  },
  closeSidebar() {
    document.getElementById("sidebar").classList.remove("open");
    document.getElementById("sidebarOverlay").classList.remove("open");
  },
};

document.addEventListener("DOMContentLoaded", () => App.init());
window.App = App;
