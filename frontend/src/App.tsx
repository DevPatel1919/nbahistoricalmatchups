import { Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import HomePage from "./pages/HomePage";
import ResultPage from "./pages/ResultPage";
import AboutPage from "./pages/AboutPage";
import TournamentPage from "./pages/TournamentPage";
import TournamentBuilderPage from "./pages/TournamentBuilderPage";
import PlansPage from "./pages/PlansPage";
import CardPage from "./pages/CardPage";
import DuelHomePage from "./pages/DuelHomePage";
import DuelJoinPage from "./pages/DuelJoinPage";
import DuelPlayPage from "./pages/DuelPlayPage";
import AccountPage from "./pages/AccountPage";
import AccountVerifyPage from "./pages/AccountVerifyPage";

export default function App() {
  return (
    <Routes>
      <Route path="card/m/:matchupSlug" element={<CardPage kind="matchup" />} />
      <Route path="card/t/:code" element={<CardPage kind="tournament" />} />
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="about" element={<AboutPage />} />
        <Route path="plans" element={<PlansPage />} />
        <Route path="tournament" element={<TournamentPage />} />
        <Route path="tournament/new" element={<TournamentBuilderPage />} />
        <Route path="t/:code" element={<TournamentPage />} />
        <Route path="duel" element={<DuelHomePage />} />
        <Route path="duel/join" element={<DuelJoinPage />} />
        <Route path="duel/:duelId" element={<DuelPlayPage />} />
        <Route path="account" element={<AccountPage />} />
        <Route path="account/verify" element={<AccountVerifyPage />} />
        <Route path=":matchupSlug" element={<ResultPage />} />
      </Route>
    </Routes>
  );
}
