function logout() {
  localStorage.removeItem('user');
  window.location.href = 'index.html';
}

function downloadCSV(type) {
  const u = JSON.parse(localStorage.getItem('user'));
  fetch(`/api/export/${type}`, { headers: { 'x-user-id': u.id } })
    .then(res => res.text())
    .then(text => {
      const blob = new Blob([text], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${type}.csv`;
      a.click();
    });
}