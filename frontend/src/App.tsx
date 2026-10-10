import { Suspense, lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import HomePage from "./pages/HomePage";
import ResultPage from "./pages/ResultPage";
import AboutPage from "./pages/AboutPage";
import TournamentPage from "./pages/TournamentPage";
import TournamentBuilderPage from "./pages/TournamentBuilderPage";
import CardPage from "./pages/CardPage";
import DuelHomePage from "./pages/DuelHomePage";
import DuelJoinPage from "./pages/DuelJoinPage";
import DuelLeaderboardPage from "./pages/DuelLeaderboardPage";
import DuelPlayPage from "./pages/DuelPlayPage";
import AccountPage from "./pages/AccountPage";
import AccountVerifyPage from "./pages/AccountVerifyPage";

// Daily Three (F12) is built only with VITE_DAILY_THREE=1. Without it /daily
// falls through to the matchup route's "couldn't find that matchup" state.
// The flag is tested inline (not through lib/dailyFlag.ts) so the build sees
// a constant and emits no DailyPage chunk at all.
const DailyPage = import.meta.env.VITE_DAILY_THREE === "1" ? lazy(() => import("./pages/DailyPage")) : null;

export default function App() {
  return (
    <Routes>
      <Route path="card/m/:matchupSlug" element={<CardPage kind="matchup" />} />
      <Route path="card/t/:code" element={<CardPage kind="tournament" />} />
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="about" element={<AboutPage />} />
        <Route path="plans" element={<Navigate to="/" replace />} />
        <Route path="tournament" element={<TournamentPage />} />
        <Route path="tournament/new" element={<TournamentBuilderPage />} />
        <Route path="t/:code" element={<TournamentPage />} />
        <Route path="duel" element={<DuelHomePage />} />
        <Route path="duel/join" element={<DuelJoinPage />} />
        <Route path="duel/leaderboard" element={<DuelLeaderboardPage />} />
        <Route path="duel/:duelId" element={<DuelPlayPage />} />
        <Route path="account" element={<AccountPage />} />
        <Route path="account/verify" element={<AccountVerifyPage />} />
        {DailyPage && (
          <Route
            path="daily"
            element={
              <Suspense
                fallback={
                  <p className="center-note">
                    <span className="loading-dot" aria-hidden="true" /> Loading&hellip;
                  </p>
                }
              >
                <DailyPage />
              </Suspense>
            }
          />
        )}
        <Route path=":matchupSlug" element={<ResultPage />} />
      </Route>
    </Routes>
  );
}
