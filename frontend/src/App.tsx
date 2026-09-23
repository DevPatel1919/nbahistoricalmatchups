import { Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import HomePage from "./pages/HomePage";
import ResultPage from "./pages/ResultPage";
import AboutPage from "./pages/AboutPage";
import TournamentPage from "./pages/TournamentPage";
import TournamentBuilderPage from "./pages/TournamentBuilderPage";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="about" element={<AboutPage />} />
        <Route path="tournament" element={<TournamentPage />} />
        <Route path="tournament/new" element={<TournamentBuilderPage />} />
        <Route path="t/:code" element={<TournamentPage />} />
        <Route path=":matchupSlug" element={<ResultPage />} />
      </Route>
    </Routes>
  );
}
