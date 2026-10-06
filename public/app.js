const API = "http://localhost:3000/api";

// ---- tab switching (Report / Browse) ----
document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const view = btn.dataset.view;
    document.getElementById("view-report").classList.toggle("hidden", view !== "report");
    document.getElementById("view-browse").classList.toggle("hidden", view !== "browse");
    if (view === "browse") loadFoundItems();
  });
});

// ---- lost / found segmented toggle ----
const typeInput = document.getElementById("item-type");
const submitBtn = document.getElementById("submit-btn");
const timeLabel = document.getElementById("time-label");

document.querySelectorAll(".seg").forEach((seg) => {
  seg.addEventListener("click", () => {
    document.querySelectorAll(".seg").forEach((s) => s.classList.remove("active"));
    seg.classList.add("active");
    typeInput.value = seg.dataset.type;
    if (seg.dataset.type === "lost") {
      submitBtn.textContent = "Submit lost report";
      timeLabel.textContent = "When lost";
    } else {
      submitBtn.textContent = "Submit found report";
      timeLabel.textContent = "When found";
    }
  });
});

// ---- form submit ----
document.getElementById("item-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = new FormData();
  form.append("type", typeInput.value);
  form.append("photo", document.getElementById("photo").files[0]);
  form.append("description", document.getElementById("description").value);
  form.append("location", document.getElementById("location").value);
  form.append("datetime", document.getElementById("datetime").value);

  submitBtn.disabled = true;
  submitBtn.textContent = "Analyzing…";

  try {
    const res = await fetch(`${API}/items`, { method: "POST", body: form });
    const data = await res.json();
    showResult(data);
    loadStats();
  } catch (err) {
    alert("Could not submit — is the backend running on port 3000?");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = typeInput.value === "lost" ? "Submit lost report" : "Submit found report";
  }
});

function showResult(data) {
  const box = document.getElementById("result");
  box.classList.remove("hidden");

  if (!data.matches || data.matches.length === 0) {
    box.innerHTML = `<h3>Report logged</h3><p style="font-size:13px;color:var(--muted)">
      No matching items yet. We'll keep checking as new reports come in — category detected: <b>${data.item.category}</b>.</p>`;
    return;
  }

  const rows = data.matches
    .map(
      (m) => `
      <div class="match-row">
        <img src="${m.photoUrl}" alt="">
        <div class="match-info">
          <div>${m.description}</div>
          <div style="color:var(--muted)">${m.location}</div>
        </div>
        <span class="match-score ${m.autoNotified ? "auto" : ""}">${m.score}% ${m.autoNotified ? "· notified" : ""}</span>
      </div>`
    )
    .join("");

  box.innerHTML = `<h3>Possible matches found</h3>${rows}`;
}

// ---- stats strip ----
async function loadStats() {
  const res = await fetch(`${API}/stats`);
  const s = await res.json();
  document.getElementById("stat-total").textContent = s.total;
  document.getElementById("stat-lost").textContent = s.lost;
  document.getElementById("stat-found").textContent = s.found;
  document.getElementById("stat-matched").textContent = s.matched;
}

// ---- browse found items ----
async function loadFoundItems() {
  const res = await fetch(`${API}/items?type=found`);
  const items = await res.json();
  const grid = document.getElementById("found-grid");
  if (items.length === 0) {
    grid.innerHTML = `<p style="color:var(--muted);font-size:13px">No found items reported yet.</p>`;
    return;
  }
  grid.innerHTML = items
    .map(
      (i) => `
    <div class="card">
      <img src="${i.photoUrl}" alt="">
      <div class="card-body">
        <div class="cat">${i.category}</div>
        <div class="desc">${i.description}</div>
        <div class="loc">${i.location}</div>
      </div>
    </div>`
    )
    .join("");
}

loadStats();
