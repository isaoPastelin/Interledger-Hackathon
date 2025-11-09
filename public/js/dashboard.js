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
<<<<<<< Updated upstream
=======

// --- New: User transaction/balance viewer ---
async function fetchJson(url) {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error((await res.json()).error || res.statusText);
  return res.json();
}

function renderTransactions(tableEl, items) {
  tableEl.innerHTML = '';
  if (!items || items.length === 0) {
    tableEl.innerHTML = '<tr><td colspan="4" style="text-align: center; color: #999; font-style: italic;">No transactions</td></tr>';
    return;
  }
  for (const it of items) {
    const tr = document.createElement('tr');

    // Set status data attribute for styling
    if (it.status) {
      tr.setAttribute('data-status', it.status);
    }

    let date;
    if (it.updatedAt && typeof it.updatedAt === 'string') {
      date = new Date(it.updatedAt).toLocaleString();
    } else if (it.updatedAt && it.updatedAt._seconds) {
      date = new Date(it.updatedAt._seconds * 1000).toLocaleString();
    } else {
      date = new Date().toLocaleString();
    }

    const scale = (it.assetScale != null) ? it.assetScale : 2;
    const amount = it.amountAtomic ? (Number(it.amountAtomic) / (10 ** (scale))).toFixed(scale) : '0.00';
    const assetCode = it.assetCode || 'USD';

    // Format direction nicely
    const direction = it.direction === 'incoming' ?
      '<span style="color: #28a745;">⬇ Incoming</span>' :
      '<span style="color: #dc3545;">⬆ Outgoing</span>';

    // Format status with color
    let statusHtml = it.status || 'Unknown';
    if (it.status === 'Completed') {
      statusHtml = '<span style="color: #28a745;">✓ ' + it.status + '</span>';
    } else if (it.status === 'Pending') {
      statusHtml = '<span style="color: #ffc107;">⏳ ' + it.status + '</span>';
    } else if (it.status === 'Failed') {
      statusHtml = '<span style="color: #dc3545;">✗ ' + it.status + '</span>';
    }

    tr.innerHTML = `
      <td>${direction}</td>
      <td><strong>${assetCode}</strong> ${amount}</td>
      <td>${statusHtml}</td>
      <td>${date}</td>
    `;
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

const syncBtn = document.getElementById('sync-now-btn');
if (syncBtn) {
  syncBtn.addEventListener('click', async () => {
    // Get userId from selector or from global variable set by the page
    const uid = userSelect ? userSelect.value : (window.currentUserId || null);
    if (!uid) return;
    syncBtn.disabled = true;
    syncBtn.textContent = 'Syncing...';
    try {
      const res = await fetch(`/dashboard/debug/sync/${uid}`, { method: 'POST', credentials: 'same-origin' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || res.statusText);
      console.log('Sync result', json);
      // reload data
      await loadUserData(uid);
    } catch (err) {
      console.error('Sync failed', err);
      alert('Sync failed: ' + (err.message || err));
    } finally {
      syncBtn.disabled = false;
      syncBtn.textContent = 'Sync Now';
    }
  });
}
>>>>>>> Stashed changes
