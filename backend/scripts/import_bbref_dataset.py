"""
Downloads the Kaggle dataset sumitrodatta/nba-aba-baa-stats ("NBA Stats
(1947-present)", scraped from Basketball-Reference) and extracts its CSV
files into data/raw/bbref/, preserving original filenames.

Daily Three (scripts/export_daily_data.py) reads two of them:
  Player Totals.csv   games started (gs) per player per team-season, every NBA
                      season from 1983-84 on; traded players have one row per
                      team plus 2TM/3TM/... total rows
  Team Abbrev.csv     each season's full team names and their abbreviations

Data rights: Kaggle labels the dataset CC0, but it is scraped from
Basketball-Reference, whose Sports Reference terms forbid scraping and any
public or commercial use without written permission. The CC0 label does not
clear that. It joins the commercial-data question in docs/product/HANDOFF.md
(F00); see reports/daily_pool.md.

Needs Kaggle credentials: ~/.kaggle/, or KAGGLE_USERNAME / KAGGLE_KEY in .env.

Run from repo root:
    python backend/scripts/import_bbref_dataset.py
"""

import shutil
import zipfile
from pathlib import Path

from dotenv import load_dotenv

# Load .env so KAGGLE_USERNAME / KAGGLE_KEY are available if set there
load_dotenv(Path(__file__).resolve().parents[2] / ".env")

REPO_ROOT = Path(__file__).resolve().parents[2]
RAW_DIR   = REPO_ROOT / "data" / "raw" / "bbref"
TMP_DIR   = REPO_ROOT / "data" / "_tmp_kaggle_bbref"

DATASET = "sumitrodatta/nba-aba-baa-stats"
NEEDED  = ("Player Totals.csv", "Team Abbrev.csv")


def main():
    try:
        import kaggle
    except ImportError:
        raise SystemExit(
            "kaggle package not found.\n"
            "Run:  pip install kaggle"
        )
    except OSError as e:
        raise SystemExit(
            f"Kaggle credential error: {e}\n"
            "Ensure ~/.kaggle/ holds your API key,\n"
            "or set KAGGLE_USERNAME and KAGGLE_KEY in your .env file."
        )

    RAW_DIR.mkdir(parents=True, exist_ok=True)
    TMP_DIR.mkdir(parents=True, exist_ok=True)

    print(f"Downloading dataset: {DATASET}")
    kaggle.api.dataset_download_files(
        DATASET,
        path=str(TMP_DIR),
        unzip=False,
        quiet=False,
    )

    zips = list(TMP_DIR.glob("*.zip"))
    if not zips:
        raise SystemExit("Download completed but no zip file found in temp directory.")

    zip_path = zips[0]
    print(f"\nExtracting {zip_path.name} ...")

    with zipfile.ZipFile(zip_path, "r") as zf:
        csv_members = [m for m in zf.namelist() if m.lower().endswith(".csv")]
        if not csv_members:
            raise SystemExit("No CSV files found inside the zip archive.")

        for member in csv_members:
            # Use only the filename, strip any subdirectory paths inside the zip
            filename = Path(member).name
            with zf.open(member) as src, open(RAW_DIR / filename, "wb") as dst:
                shutil.copyfileobj(src, dst)
            print(f"  ✓  {filename}")

    shutil.rmtree(TMP_DIR)

    missing = [name for name in NEEDED if not (RAW_DIR / name).exists()]
    if missing:
        raise SystemExit("The dataset no longer has " + ", ".join(missing) + "; Daily Three needs them.")

    print(f"\nDone. {len(csv_members)} file(s) saved to {RAW_DIR}")


if __name__ == "__main__":
    main()
