/* ============================================================
   ОБЛАКО (Firebase)  — необязательный слой синхронизации
   Загружает Firebase SDK с CDN (без npm). Если конфиг не заполнен,
   тихо отключается, и приложение работает только локально.
   ============================================================ */
const Cloud = {
  configured: false,
  ready: false,
  user: null,
  status: "idle",          // idle | loading | error
  lastError: "",
  _auth: null, _fs: null, _authMod: null, _fsMod: null,

  isConfigured() {
    const c = window.FIREBASE_CONFIG;
    return !!(c && c.apiKey && c.apiKey.indexOf("PASTE_YOUR") !== 0 &&
              c.projectId && c.projectId.indexOf("PASTE_YOUR") !== 0);
  },

  async init() {
    if (!this.isConfigured()) { this.configured = false; return; }
    if (location.protocol === "file:") { this.configured = true; this.status = "error";
      this.lastError = "Облако работает только через сервер (http/https), не из file://."; return; }
    this.configured = true;
    this.status = "loading";
    try {
      const V = "https://www.gstatic.com/firebasejs/10.12.2";
      const appMod  = await import(`${V}/firebase-app.js`);
      const authMod = await import(`${V}/firebase-auth.js`);
      const fsMod   = await import(`${V}/firebase-firestore.js`);
      const app = appMod.initializeApp(window.FIREBASE_CONFIG);
      this._authMod = authMod; this._fsMod = fsMod;
      this._auth = authMod.getAuth(app);
      this._fs = fsMod.getFirestore(app);
      this.ready = true; this.status = "idle";
      authMod.onAuthStateChanged(this._auth, (u) => {
        this.user = u;
        if (typeof window.onCloudChange === "function") window.onCloudChange(u);
      });
    } catch (e) {
      this.status = "error"; this.lastError = (e && e.message) || "Не удалось загрузить Firebase";
      this.ready = false;
    }
  },

  async signUp(email, password) {
    if (!this.ready) throw new Error("Облако не готово");
    await this._authMod.createUserWithEmailAndPassword(this._auth, email, password);
  },
  async signIn(email, password) {
    if (!this.ready) throw new Error("Облако не готово");
    await this._authMod.signInWithEmailAndPassword(this._auth, email, password);
  },
  async signOut() {
    if (!this.ready) return;
    await this._authMod.signOut(this._auth);
    this.user = null;
  },

  _docRef() { return this._fsMod.doc(this._fs, "users", this.user.uid); },

  async push(storeObj) {
    if (!this.ready || !this.user) return;
    await this._fsMod.setDoc(this._docRef(), { store: storeObj, updatedAt: Date.now() });
  },
  async pull() {
    if (!this.ready || !this.user) return null;
    const snap = await this._fsMod.getDoc(this._docRef());
    return snap.exists() ? snap.data() : null;
  }
};
window.Cloud = Cloud;
