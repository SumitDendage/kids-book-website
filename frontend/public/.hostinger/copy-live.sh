#!/bin/sh
# Learn With Why: run every 5 minutes by a Hostinger cron job (hPanel -> Advanced -> Cron Jobs):
#   sh /home/u986984762/domains/learnwithwhy.com/public_html/_live/.hostinger/copy-live.sh
# Hostinger pulls the live-site branch (the built website) into public_html/_live after every
# merge; this copies it into the site, replacing only older files. It never deletes anything.
# The cron command itself stays this one plain line because Hostinger escapes && and * in it.
cd "$(dirname "$0")/../.." || exit 1
cp -au _live/* _live/.htaccess . && date -u '+%Y-%m-%d %H:%M UTC' > _live/.hostinger/last-copy.txt
