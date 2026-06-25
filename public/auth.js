// Shared account helpers for Lobster Game Box
(function () {
  const API = '';
  let currentUser = null;

  function loadUser() {
    try {
      const raw = localStorage.getItem('gameBoxUser');
      if (raw) currentUser = JSON.parse(raw);
    } catch (e) { currentUser = null; }
  }
  loadUser();

  function saveUser(u) {
    currentUser = u;
    if (u) localStorage.setItem('gameBoxUser', JSON.stringify(u));
    else localStorage.removeItem('gameBoxUser');
    document.dispatchEvent(new CustomEvent('gameBoxUserChanged', { detail: currentUser }));
  }

  async function api(method, path, body) {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(API + path, opts);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || '请求失败');
    return data;
  }

  window.Auth = {
    user() { return currentUser; },
    isLoggedIn() { return !!currentUser; },
    token() { return currentUser ? currentUser.token : null; },
    name() { return currentUser ? currentUser.name : null; },
    setUser: saveUser,
    logout() { saveUser(null); },
    async register(account, password, name) {
      const data = await api('POST', '/api/auth/register', { account, password, name });
      saveUser({ id: data.id, account: data.account, name: data.name, token: data.token });
      return data;
    },
    async login(account, password) {
      const data = await api('POST', '/api/auth/login', { account, password });
      saveUser({ id: data.id, account: data.account, name: data.name, token: data.token });
      return data;
    },
    async rename(newName) {
      const token = currentUser ? currentUser.token : '';
      const data = await api('POST', '/api/auth/rename', { token, name: newName });
      currentUser.name = data.name;
      saveUser(currentUser);
      return data;
    },
    async getRecords() {
      const token = currentUser ? currentUser.token : '';
      return api('GET', '/api/users/records?token=' + encodeURIComponent(token));
    },
    async submitScore(game, score) {
      if (!currentUser) return { skipped: true };
      const token = currentUser.token;
      return api('POST', '/api/leaderboard/submit', { token, game, score });
    },
    async getLeaderboard(game, limit = 20) {
      return api('GET', '/api/leaderboard?game=' + encodeURIComponent(game) + '&limit=' + limit);
    }
  };

  window.getDefaultName = function () {
    return currentUser ? currentUser.name : '';
  };
})();
