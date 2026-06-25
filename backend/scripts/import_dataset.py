"""
Downloads the Kaggle dataset eoinamoore/historical-nba-data-and-player-box-scores
and extracts all CSV files into data/raw/, preserving original filenames.

"""

import os
import zipfile
import shutil
from pathlib import Path
from dotenv import load_dotenv

# Load .env so KAGGLE_USERNAME / KAGGLE_KEY are available if set there
load_dotenv(Path(__file__).resolve().parents[2] / ".env")

REPO_ROOT = Path(__file__).resolve().parents[2]
RAW_DIR   = REPO_ROOT / "data" / "raw"
TMP_DIR   = REPO_ROOT / "data" / "_tmp_kaggle"

DATASET = "eoinamoore/historical-nba-data-and-player-box-scores"

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
            "Ensure ~/.kaggle/kaggle.json exists with your API key,\n"
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
        members = zf.namelist()
        csv_members = [m for m in members if m.lower().endswith(".csv")]

        if not csv_members:
            raise SystemExit("No CSV files found inside the zip archive.")

        for member in csv_members:
            # Use only the filename, strip any subdirectory paths inside the zip
            filename = Path(member).name
            target   = RAW_DIR / filename

            with zf.open(member) as src, open(target, "wb") as dst:
                shutil.copyfileobj(src, dst)

            print(f"  ✓  {filename}")

    # Clean up temp directory
    shutil.rmtree(TMP_DIR)

    print(f"\nDone. {len(csv_members)} file(s) saved to {RAW_DIR}")


if __name__ == "__main__":
    main()
