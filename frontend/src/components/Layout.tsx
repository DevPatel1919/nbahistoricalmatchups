import { Link, Outlet } from "react-router-dom";
import ThemeToggle from "./ThemeToggle";
import { useTheme } from "../hooks/useTheme";

export default function Layout() {
  const [theme, toggleTheme] = useTheme();

  return (
    <div className="app-shell">
      <header className="site-header">
        <div className="site-header__inner">
          <Link to="/" className="brand">
            <span className="brand__mark" aria-hidden="true" />
            <span className="brand__name">Court of All Time</span>
          </Link>
          <nav className="site-nav" aria-label="Primary">
            <Link to="/about">About</Link>
            <ThemeToggle theme={theme} onToggle={toggleTheme} />
          </nav>
        </div>
      </header>

      <main className="site-main">
        <Outlet />
      </main>

      <footer className="site-footer">
        <p>
          Court of All Time is an unofficial fan project. Not affiliated with the NBA or any team.
          Results are model projections for fun, not betting advice.
        </p>
      </footer>
    </div>
  );
}
