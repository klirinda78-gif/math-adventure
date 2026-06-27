/* ============================================================
   НАСТРОЙКА FIREBASE  (заполни своими данными — это всё, что нужно)
   ------------------------------------------------------------
   Как получить:
   1. Зайди на https://console.firebase.google.com → «Создать проект».
   2. Внутри проекта: «Build» → «Authentication» → включи способ
      входа «Email/Password».
   3. «Build» → «Firestore Database» → «Создать базу» (можно в тестовом
      режиме на время разработки).
   4. «Project settings» (шестерёнка) → «Your apps» → значок </> (Web) →
      зарегистрируй приложение → скопируй объект firebaseConfig сюда.

   Пока поля не заполнены — приложение работает как обычно (только
   локально), а раздел «Облако» в Профиле показывает инструкцию.
   ============================================================ */
window.FIREBASE_CONFIG = {
  apiKey: "PASTE_YOUR_API_KEY",
  authDomain: "PASTE_YOUR_PROJECT.firebaseapp.com",
  projectId: "PASTE_YOUR_PROJECT_ID",
  storageBucket: "PASTE_YOUR_PROJECT.appspot.com",
  messagingSenderId: "PASTE_YOUR_SENDER_ID",
  appId: "PASTE_YOUR_APP_ID"
};
