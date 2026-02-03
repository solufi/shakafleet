#!/bin/bash

# Chemin du fichier de conf nginx sur la VM
CONF_FILE="/opt/fleet/deploy/vm/nginx/conf.d/fleet.shakadistribution.ca.conf"

# Backup du fichier original
sudo cp "$CONF_FILE" "${CONF_FILE}.bak.$(date +%s)"

# Ajoute la location /api/ sans mTLS juste avant le dernier }
# Utilise awk pour insérer avant la dernière accolade
awk '
BEGIN { in_server = 0; brace_level = 0 }
{
  if ($0 ~ /server {/) { in_server = 1; brace_level = 1 }
  if (in_server) {
    if ($0 ~ /{/) brace_level++
    if ($0 ~ /}/) brace_level--
    if (brace_level == 1 && $0 ~ /}/) {
      # Insère la location /api/ avant la dernière accolade
      print ""
      print "  # APIs: no mTLS"
      print "  location /api/ {"
      print "    proxy_pass http://fleet-manager:3000;"
      print "    proxy_set_header Host $host;"
      print "    proxy_set_header X-Forwarded-Proto $scheme;"
      print "    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;"
      print "  }"
      print ""
    }
  }
  print
}
' "${CONF_FILE}" > "${CONF_FILE}.tmp" && sudo mv "${CONF_FILE}.tmp" "$CONF_FILE"

echo "✅ nginx conf updated – location /api/ added without mTLS"
echo "🔄 Reloading nginx..."
sudo docker compose restart nginx

echo "✅ Done. Test with:"
echo "curl https://fleet.shakadistribution.ca/api/machines"
