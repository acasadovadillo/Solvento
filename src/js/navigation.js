function formatEur(val) {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(val);
}

function showPage(id) {
  const current = document.querySelector(".page.active");
  const alreadyActive = current && current.id === "page-" + id;
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  const pg = document.getElementById("page-" + id);
  if (pg) pg.classList.add("active");
  const sel = document.querySelector(".nav-select");
  if (sel) sel.value = id;
  window.location.hash = id;
  if (alreadyActive) window.scrollTo({ top: 0, behavior: "smooth" });
}

(function () {
  const hash = window.location.hash.replace("#", "");
  if (hash) showPage(hash);
})();

function showMovimientos(cuenta) {
  showPage("movimientos");
  const badge = document.getElementById("mov-filter-badge");
  const label = document.getElementById("mov-filter-label");
  const saldoEl = document.getElementById("mov-filter-saldo");
  const rows = document.querySelectorAll("#mov-tbody tr");
  if (cuenta) {
    if (badge) badge.style.display = "inline-flex";
    if (label) label.textContent = cuenta + " · ";
    if (saldoEl && typeof saldosCuentas !== "undefined" && saldosCuentas[cuenta] !== undefined) {
      saldoEl.textContent = new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(saldosCuentas[cuenta]) + " €";
    }
    rows.forEach(tr => {
      const cuentas = (tr.dataset.cuentas || "").split("|");
      tr.style.display = cuentas.includes(cuenta) ? "" : "none";
    });
  } else {
    if (badge) badge.style.display = "none";
    rows.forEach(tr => tr.style.display = "");
  }
}

function filterCuentasMov(btn, cuenta) {
  document.querySelectorAll(".cmov-tab").forEach(b => {
    b.style.borderBottom = "2px solid transparent";
    b.style.color = "#6b7280";
    b.style.fontWeight = "400";
  });
  btn.style.borderBottom = "2px solid #ffffff";
  btn.style.color = "#ffffff";
  btn.style.fontWeight = "700";
  document.querySelectorAll("#cuentas-mov-tbody tr").forEach(tr => {
    if (cuenta === "__all__") {
      // In Todos, hide the destination-side of traspasos to avoid double-counting
      tr.style.display = tr.dataset.traspasoDir === "entrada" ? "none" : "";
    } else {
      tr.style.display = (tr.dataset.cuentas || "").split("|").includes(cuenta) ? "" : "none";
    }
  });
}

function movFiltrar() {
  const q = (document.getElementById('mov-search')?.value || '').toLowerCase().trim();
  let visible = 0;
  document.querySelectorAll('#mov-tbody tr').forEach(tr => {
    const match = !q || (tr.dataset.search || '').includes(q);
    tr.style.display = match ? '' : 'none';
    if (match) visible++;
  });
  const empty = document.getElementById('mov-empty');
  if (empty) empty.style.display = visible === 0 ? '' : 'none';
}

let explorarTipoActivo = '__all__';

function explorarSetTipo(btn, tipo) {
  explorarTipoActivo = tipo;
  document.querySelectorAll('.explorar-tab').forEach(b => {
    b.style.borderBottom = '2px solid transparent';
    b.style.color = '#6b7280';
    b.style.fontWeight = '400';
  });
  btn.style.borderBottom = '2px solid #ffffff';
  btn.style.color = '#ffffff';
  btn.style.fontWeight = '700';
  explorarFiltrar();
}

function explorarFiltrar() {
  const q = (document.getElementById('explorar-search')?.value || '').toLowerCase();
  let visible = 0;
  document.querySelectorAll('.asset-card').forEach(card => {
    const matchTipo   = explorarTipoActivo === '__all__' || card.dataset.tipo === explorarTipoActivo;
    const matchSearch = !q || (card.dataset.search || '').includes(q);
    card.style.display = matchTipo && matchSearch ? '' : 'none';
    if (matchTipo && matchSearch) visible++;
  });
  const empty = document.getElementById('explorar-empty');
  if (empty) empty.style.display = visible === 0 ? '' : 'none';
}


document.querySelectorAll(".donut").forEach(donut => {
  const wrapper = donut.closest(".chart-wrapper");
  const label = wrapper ? wrapper.querySelector(".chart-label") : null;
  donut.querySelectorAll(".sector").forEach(s => {
    const t = s.querySelector("title");
    if (!t || !label) return;
    s.addEventListener("mouseenter", () => {
      label.textContent = t.textContent;
      label.style.opacity = "1";
      label.style.transform = "translateX(-50%) translateY(-5px)";
    });
    s.addEventListener("mouseleave", () => {
      label.style.opacity = "0";
      label.style.transform = "translateX(-50%)";
    });
  });
});
