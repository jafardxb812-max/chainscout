#!/bin/bash
set -e

DOMAIN="matrixchain.shop"
EMAIL="aja600780@gmail.com"

echo "=== Chainscout VPS Deploy — $DOMAIN ==="

# Ubuntu system tuning for max performance
echo "[0/5] Tuning Ubuntu kernel..."
cat >> /etc/sysctl.conf << 'EOF'
net.core.somaxconn = 65535
net.core.netdev_max_backlog = 65535
net.ipv4.tcp_max_syn_backlog = 65535
net.ipv4.tcp_fin_timeout = 10
net.ipv4.tcp_tw_reuse = 1
net.ipv4.ip_local_port_range = 1024 65535
net.ipv4.tcp_rmem = 4096 87380 16777216
net.ipv4.tcp_wmem = 4096 65536 16777216
fs.file-max = 200000
EOF
sysctl -p

# Increase file descriptor limits
echo "* soft nofile 65535" >> /etc/security/limits.conf
echo "* hard nofile 65535" >> /etc/security/limits.conf

# Step 1: Start app (HTTP only first for certbot)
echo "[1/5] Building and starting app..."
docker compose up -d --build app

echo "[2/5] Waiting for app to be healthy..."
sleep 15

# Step 2: Start nginx (HTTP only mode — temp config)
echo "[3/5] Starting nginx for SSL challenge..."
docker compose up -d nginx

# Step 3: Get SSL certificate
echo "[4/5] Getting SSL certificate..."
docker compose run --rm certbot certonly \
  --webroot \
  --webroot-path=/var/www/certbot \
  --email "$EMAIL" \
  --agree-tos \
  --no-eff-email \
  -d "$DOMAIN" \
  -d "www.$DOMAIN"

# Step 4: Restart nginx with full SSL config
echo "[5/5] Restarting nginx with SSL..."
docker compose restart nginx

# Start certbot auto-renewal
docker compose up -d certbot

echo ""
echo "==================================="
echo "Deploy complete!"
echo "Site live at: https://$DOMAIN"
echo "==================================="
