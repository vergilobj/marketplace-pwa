#!/bin/bash
# Marketplace PWA — Mirror Deployment Script
# Клонирует приложение на новый сервер/домен за < 1 часа.
# Использование: bash mirror-deploy.sh user@new-server new-domain.ru

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

if [ $# -lt 2 ]; then
    echo "Usage: bash mirror-deploy.sh <ssh-target> <new-domain>"
    echo "Example: bash mirror-deploy.sh root@192.168.1.100 marketplace2.ru"
    exit 1
fi

TARGET="$1"
DOMAIN="$2"
SRC="/opt/marketplace"
REMOTE_SRC="/opt/marketplace"

echo -e "${GREEN}=== Marketplace Mirror Deploy ===${NC}"
echo "Target: $TARGET"
echo "Domain: $DOMAIN"
echo ""

# Step 1: Rsync code
echo -e "${GREEN}[1/6] Syncing code...${NC}"
rsync -avz --exclude 'node_modules' --exclude 'dist' --exclude 'uploads' \
    "$SRC/" "$TARGET:$REMOTE_SRC/"

# Step 2: Dump & transfer DB
echo -e "${GREEN}[2/6] Dumping database...${NC}"
ssh "$TARGET" "docker exec marketplace-db pg_dump -U market_user marketplace > /tmp/marketplace-backup.sql" || \
    echo "DB dump via SSH failed — trying local..." && \
    pg_dump -U market_user marketplace > /tmp/marketplace-backup.sql && \
    scp /tmp/marketplace-backup.sql "$TARGET:/tmp/"

# Step 3: Restore DB on target
echo -e "${GREEN}[3/6] Restoring database on target...${NC}"
ssh "$TARGET" "docker exec -i marketplace-db psql -U market_user marketplace < /tmp/marketplace-backup.sql"

# Step 4: Setup env & build
echo -e "${GREEN}[4/6] Building backend...${NC}"
ssh "$TARGET" "cd $REMOTE_SRC/backend && npm ci && npx prisma generate && npm run build"

echo -e "${GREEN}[5/6] Building frontend...${NC}"
ssh "$TARGET" "cd $REMOTE_SRC/frontend && npm ci && npm run build"

# Step 5: Update nginx & SSL
echo -e "${GREEN}[6/6] Configuring domain...${NC}"
ssh "$TARGET" "
    sed -i 's/server_name .*/server_name $DOMAIN www.$DOMAIN;/' $REMOTE_SRC/nginx.conf &&
    certbot --nginx -d $DOMAIN -d www.$DOMAIN --non-interactive --agree-tos --email admin@$DOMAIN || true
"

# Step 6: Restart backend
echo -e "${GREEN}Starting services...${NC}"
ssh "$TARGET" "pkill -f 'node dist/src/main.js' || true && cd $REMOTE_SRC/backend && node dist/src/main.js &"

echo ""
echo -e "${GREEN}=== Mirror deployed to https://$DOMAIN ===${NC}"
echo ""
echo "Next steps:"
echo "  1. Add $DOMAIN to OneSignal Origins in dashboard"
echo "  2. Update CORS_ORIGIN in backend/.env to https://$DOMAIN"
echo "  3. Send push notification to users about new domain"
