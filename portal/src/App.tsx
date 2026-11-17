import { Link, Route, Routes } from "react-router-dom";

import { AppShell } from "./components/AppShell";
import { HelpPage } from "./pages/HelpPage";
import { HomePage } from "./pages/HomePage";
import { SettingsPage } from "./pages/SettingsPage";

function NotFoundPage() {
  return (
    <section className="page-header not-found">
      <p className="eyebrow">404</p>
      <h1>That page is not part of the Hub.</h1>
      <p className="page-lede">
        The portal only has Home, Settings and Help. Use the navigation above, or
        return to the module overview.
      </p>
      <Link className="button button--primary" to="/">
        Back to Home
      </Link>
    </section>
  );
}

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<HomePage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="help" element={<HelpPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
