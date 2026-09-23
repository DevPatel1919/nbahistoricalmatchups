import { useState } from "react";
import { renderCardBlob, shareOrDownloadImage } from "../share/shareImage";

interface Props {
  draw: (ctx: CanvasRenderingContext2D) => void;
  filename: string;
  title: string;
  /** Called once the image was shared or downloaded. */
  onShared: () => void;
  label?: string;
}

/** Renders a 1200x630 share card and hands it to the share sheet, or downloads it. */
export default function ShareImageButton({ draw, filename, title, onShared, label = "Share image" }: Props) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const handleClick = async () => {
    setBusy(true);
    setFailed(false);
    try {
      const blob = await renderCardBlob(draw);
      if (await shareOrDownloadImage(blob, filename, title)) onShared();
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button type="button" className="btn" onClick={handleClick} disabled={busy}>
      {busy ? "Drawing…" : label}
      {failed && <span className="copy-feedback">Couldn't make the image</span>}
    </button>
  );
}
