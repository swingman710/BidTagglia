// Guard: admin pages require an admin session.
if (sessionStorage.getItem("battag_admin") !== "1") {
  window.location.href = "index.html";
}

document.getElementById("logout").addEventListener("click", () => {
  sessionStorage.removeItem("battag_user");
  sessionStorage.removeItem("battag_admin");
  window.location.href = "index.html";
});

const listsEl = document.getElementById("lists");
const listsEmpty = document.getElementById("lists-empty");

function render() {
  const lists = loadLists();
  const names = Object.keys(lists);

  listsEl.innerHTML = "";
  listsEmpty.style.display = names.length === 0 ? "block" : "none";

  for (const name of names) {
    const options = lists[name];

    const card = document.createElement("div");
    card.className = "list-card";

    // Header with delete-list button.
    const head = document.createElement("div");
    head.className = "list-head";
    const title = document.createElement("h3");
    title.textContent = name;
    const delList = document.createElement("button");
    delList.className = "btn-sm ghost";
    delList.textContent = "Delete";
    delList.addEventListener("click", () => deleteList(name));
    head.append(title, delList);
    card.appendChild(head);

    // Options.
    if (options.length === 0) {
      const none = document.createElement("div");
      none.className = "empty-opt";
      none.textContent = "No options yet.";
      card.appendChild(none);
    } else {
      options.forEach((opt, i) => {
        const row = document.createElement("div");
        row.className = "option-row";
        const label = document.createElement("span");
        label.textContent = opt;
        const x = document.createElement("button");
        x.className = "x";
        x.textContent = "✕";
        x.title = "Remove option";
        x.addEventListener("click", () => removeOption(name, i));
        row.append(label, x);
        card.appendChild(row);
      });
    }

    // Add-option form.
    const addForm = document.createElement("form");
    addForm.className = "add-option";
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Add option…";
    const addBtn = document.createElement("button");
    addBtn.type = "submit";
    addBtn.className = "btn-sm";
    addBtn.textContent = "Add";
    addForm.append(input, addBtn);
    addForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const value = input.value.trim();
      if (value) addOption(name, value);
    });
    card.appendChild(addForm);

    listsEl.appendChild(card);
  }
}

// ---------- Actions ----------

function addList(name) {
  const lists = loadLists();
  if (lists[name]) {
    alert(`A dropdown called "${name}" already exists.`);
    return;
  }
  lists[name] = [];
  saveLists(lists);
  render();
}

function deleteList(name) {
  if (!confirm(`Delete the "${name}" dropdown and all its options?`)) return;
  const lists = loadLists();
  delete lists[name];
  saveLists(lists);
  render();
}

function addOption(listName, value) {
  const lists = loadLists();
  if (!lists[listName]) return;
  if (lists[listName].includes(value)) return;
  lists[listName].push(value);
  saveLists(lists);
  render();
}

function removeOption(listName, index) {
  const lists = loadLists();
  if (!lists[listName]) return;
  lists[listName].splice(index, 1);
  saveLists(lists);
  render();
}

document.getElementById("new-list-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = document.getElementById("new-list-name");
  const name = input.value.trim();
  if (!name) return;
  addList(name);
  input.value = "";
});

render();
