const $ = (id) => document.getElementById(id);

const output = $("output");
const selectedAccount = $("selectedAccount");

function writeOut(data) {
  output.textContent = typeof data === "string" ? data : JSON.stringify(data, null, 2);
}

async function refreshAccounts() {
  const list = await eel.list_accounts()();
  const container = $("accounts");
  container.innerHTML = "";
  selectedAccount.innerHTML = "";

  for (const acc of list) {
    const row = document.createElement("div");
    row.className = "account-item";
    row.innerHTML = `
      <div>
        <strong>${acc.name}</strong><br>
        <small>${acc.phone} • ${acc.authorized ? "Авторизован" : "Не авторизован"}</small>
      </div>
      <button data-remove="${acc.name}">Удалить</button>
    `;
    container.appendChild(row);

    const opt = document.createElement("option");
    opt.value = acc.name;
    opt.textContent = acc.name;
    selectedAccount.appendChild(opt);
  }

  container.querySelectorAll("button[data-remove]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const res = await eel.remove_account(btn.dataset.remove)();
      writeOut(res);
      await refreshAccounts();
    });
  });
}

$("addBtn").addEventListener("click", async () => {
  const res = await eel.add_account(
    $("name").value.trim(),
    $("api_id").value.trim(),
    $("api_hash").value.trim(),
    $("phone").value.trim()
  )();
  writeOut(res);
  if (res.ok) {
    ["name", "api_id", "api_hash", "phone"].forEach((id) => ($(id).value = ""));
    await refreshAccounts();
  }
});

$("reqCodeBtn").addEventListener("click", async () => {
  const res = await eel.request_code(selectedAccount.value)();
  writeOut(res);
});

$("signinBtn").addEventListener("click", async () => {
  const res = await eel.sign_in(selectedAccount.value, $("code").value.trim(), $("password").value.trim())();
  writeOut(res);
  await refreshAccounts();
});

$("dialogsBtn").addEventListener("click", async () => {
  const res = await eel.fetch_dialogs(selectedAccount.value, 30)();
  writeOut(res);
});

$("sendBtn").addEventListener("click", async () => {
  const res = await eel.send_message(selectedAccount.value, $("target").value.trim(), $("text").value.trim())();
  writeOut(res);
});

refreshAccounts();
