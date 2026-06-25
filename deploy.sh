#!/bin/bash
set -e

DOMAIN=${1:-"YOUR_DOMAIN.com"}
EMAIL=${2:-"your@email.com"}

echo "=== Chainscout VPS Deploy Script ==="
echo "Domain: $DOMAIN"

# Update nginx config with actual domain
sed -i "s/YOUR_DOMAIN.com/$DOMAIN/g" nginx/nginx.conf

# Step 1: Start with HTTP only (for certbot challenge)
echo "[1/4] Starting app..."
docker compose up -d app

# Step 2: Get SSL certificate
echo "[2/4] Getting SSL certificate..."
docker compose run --rm certbot certonly \
  --webroot \
  --webroot-path=/var/www/certbot \
  --email "$EMAIL" \
  --agree-tos \
  --no-eff-email \
  -d "$DOMAIN"

# Step 3: Start nginx with SSL
echo "[3/4] Starting nginx..."
docker compose up -d nginx

# Step 4: Done
echo "[4/4] Deploy complete!"
echo "Site live at: https://$DOMAIN"
