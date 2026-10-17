#!/bin/bash

echo "--------------------------------------------------"
read -p "WARNING: PLEASE MAKE SURE NEW JSON FILES ARE IN DOWNLOADS BEFORE PROCEEDING? [Press Enter]"
echo "--------------------------------------------------"

# 1. FORCE the script to start inside the folder where this script lives (REFRESH MODULES)
cd "$(dirname "$0")"

# 2. CLEAN UP any stuck Git states just in case
git rebase --abort 2>/dev/null
git merge --abort 2>/dev/null
rm -rf .git/rebase-merge 2>/dev/null

# 3. Pull latest changes from GitHub cleanly
git pull origin main

# 4. Clear out old JSON files from the 'aap' folder
rm -f aap/*.json

# 5. Move new JSON files from Downloads (one level up: ../) into the 'aap' folder
mv ../*.json aap/

# 6. Run git commit and push
git add .
git commit -m "Moved JSON files to final destination"
git push origin main

echo "--------------------------------------------------"
echo "Done! Files updated and pushed successfully."
echo "--------------------------------------------------"