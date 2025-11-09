document.getElementById('transfer-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const formData = new FormData(e.target);
  const data = {
    from_user_id: formData.get('from_user_id'),
    to_user_id: formData.get('to_user_id'),
    amount: formData.get('amount'),
    description: formData.get('description')
  };

  // Validate
  if (data.from_user_id === data.to_user_id) {
    showMessage('Cannot transfer to the same account', 'error');
    return;
  }

  try {
    const response = await fetch('/dashboard/transfer', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    });

    const result = await response.json();

    if (response.ok) {
      showMessage('Transfer successful! Reloading...', 'success');
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    } else {
      showMessage(result.error || 'Transfer failed', 'error');
    }
  } catch (error) {
    showMessage('An error occurred: ' + error.message, 'error');
  }
});

function showMessage(message, type) {
  const messageDiv = document.getElementById('transfer-message');
  messageDiv.textContent = message;
  messageDiv.className = type;
  messageDiv.style.display = 'block';

  if (type === 'success') {
    setTimeout(() => {
      messageDiv.style.display = 'none';
    }, 3000);
  }
}

// --- New: User transaction/balance viewer ---
async function fetchJson(url) {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error((await res.json()).error || res.statusText);
  return res.json();
}

function renderTransactions(tableEl, items) {
  tableEl.innerHTML = '';
  if (!items || items.length === 0) {
    tableEl.innerHTML = '<tr><td colspan="4">No transactions</td></tr>';
    return;
  }
  for (const it of items) {
    const tr = document.createElement('tr');
    const date = new Date((it.updatedAt && it.updatedAt._seconds) ? it.updatedAt._seconds * 1000 : Date.now()).toLocaleString();
    tr.innerHTML = `<td>${it.direction}</td><td>${it.assetCode || ''} ${it.amountAtomic ? (Number(it.amountAtomic) / (10 ** (it.assetScale || 0))).toFixed(it.assetScale || 0) : ''}</td><td>${it.status || ''}</td><td>${date}</td>`;
    tableEl.appendChild(tr);
  }
}

async function loadUserData(userId) {
  const incomingTable = document.getElementById('incoming-table-body');
  const outgoingTable = document.getElementById('outgoing-table-body');
  const balanceEl = document.getElementById('user-balance');

  incomingTable.innerHTML = '<tr><td colspan="4">Loading...</td></tr>';
  outgoingTable.innerHTML = '<tr><td colspan="4">Loading...</td></tr>';
  balanceEl.textContent = 'Loading...';

  try {
    const [inc, out, balRes] = await Promise.all([
      fetchJson(`/dashboard/api/user/${userId}/transactions?direction=incoming&limit=100`),
      fetchJson(`/dashboard/api/user/${userId}/transactions?direction=outgoing&limit=100`),
      fetchJson(`/dashboard/api/user/${userId}/balance`)
    ]);

    renderTransactions(incomingTable, inc.items || []);
    renderTransactions(outgoingTable, out.items || []);

    if (balRes && balRes.balance) {
      const b = balRes.balance;
      balanceEl.textContent = b.balanceHuman || (b.balanceAtomic ? b.balanceAtomic.toString() : '0');
    } else {
      balanceEl.textContent = 'N/A';
    }
  } catch (err) {
    incomingTable.innerHTML = '<tr><td colspan="4">Error loading</td></tr>';
    outgoingTable.innerHTML = '<tr><td colspan="4">Error loading</td></tr>';
    balanceEl.textContent = 'Error';
    console.error('Load user data failed', err);
  }
}

// If there's a user selector on the page, wire it up
const userSelect = document.getElementById('user-view-select');
if (userSelect) {
  userSelect.addEventListener('change', (e) => {
    const uid = e.target.value;
    if (uid) loadUserData(uid);
  });
  // load initial value
  if (userSelect.value) loadUserData(userSelect.value);
}
