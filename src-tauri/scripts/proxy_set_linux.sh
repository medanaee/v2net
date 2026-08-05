#!/bin/bash
# Mirrored from v2rayN ServiceLib/Sample/proxy_set_linux_sh
# Usage: proxy_set_linux.sh <manual|none> [proxy_ip proxy_port ignore_hosts]

trim() {
    local -n ref=$1
    ref="${ref#"${ref%%[![:space:]]*}"}"
    ref="${ref%"${ref##*[![:space:]]}"}"
}

build_gsettings_array() {
    [[ -z "$1" ]] && echo "[]" && return
    local host joined hosts=()
    IFS=',' read -ra parts <<< "$1"
    for host in "${parts[@]}"; do
        trim host
        [[ -n "$host" ]] && hosts+=("$host")
    done
    [[ ${#hosts[@]} -eq 0 ]] && echo "[]" && return
    printf -v joined "'%s'," "${hosts[@]}"
    echo "[${joined%,}]"
}

set_gnome_proxy() {
    local MODE=$1
    local PROXY_IP=$2
    local PROXY_PORT=$3
    local IGNORE_HOSTS=$4

    gsettings set org.gnome.system.proxy mode "$MODE"

    if [ "$MODE" = "manual" ]; then
        local PROTOCOLS=("http" "https" "ftp" "socks")
        for PROTOCOL in "${PROTOCOLS[@]}"; do
            gsettings set org.gnome.system.proxy."$PROTOCOL" host "$PROXY_IP"
            gsettings set org.gnome.system.proxy."$PROTOCOL" port "$PROXY_PORT"
        done
        gsettings set org.gnome.system.proxy ignore-hosts "$(build_gsettings_array "$IGNORE_HOSTS")"
        echo "GNOME: Manual proxy settings applied ($PROXY_IP:$PROXY_PORT)."
    elif [ "$MODE" = "none" ]; then
        echo "GNOME: Proxy disabled."
    fi
}

set_kde_proxy() {
    local MODE=$1
    local PROXY_IP=$2
    local PROXY_PORT=$3
    local IGNORE_HOSTS=$4

    if [ "${KDE_SESSION_VERSION:-}" = "6" ]; then
        KWRITECONFIG="kwriteconfig6"
    else
        KWRITECONFIG="kwriteconfig5"
    fi

    if ! command -v "$KWRITECONFIG" >/dev/null 2>&1; then
        echo "KDE: $KWRITECONFIG not found, skipping KDE proxy."
        return 0
    fi

    if [ "$MODE" = "manual" ]; then
        $KWRITECONFIG --file kioslaverc --group "Proxy Settings" --key ProxyType 1
        $KWRITECONFIG --file kioslaverc --group "Proxy Settings" --key httpProxy "http://$PROXY_IP:$PROXY_PORT"
        $KWRITECONFIG --file kioslaverc --group "Proxy Settings" --key httpsProxy "http://$PROXY_IP:$PROXY_PORT"
        $KWRITECONFIG --file kioslaverc --group "Proxy Settings" --key ftpProxy "http://$PROXY_IP:$PROXY_PORT"
        $KWRITECONFIG --file kioslaverc --group "Proxy Settings" --key socksProxy "socks://$PROXY_IP:$PROXY_PORT"
        $KWRITECONFIG --file kioslaverc --group "Proxy Settings" --key NoProxyFor "$IGNORE_HOSTS"
        echo "KDE: Manual proxy settings applied ($PROXY_IP:$PROXY_PORT)."
    elif [ "$MODE" = "none" ]; then
        $KWRITECONFIG --file kioslaverc --group "Proxy Settings" --key ProxyType 0
        echo "KDE: Proxy disabled."
    fi

    dbus-send --type=signal /KIO/Scheduler org.kde.KIO.Scheduler.reparseSlaveConfiguration string:"" 2>/dev/null || true
}

detect_desktop_environment() {
    local desktop="${XDG_CURRENT_DESKTOP:-}${XDG_SESSION_DESKTOP:-}"
    desktop=$(printf '%s' "$desktop" | tr '[:upper:]' '[:lower:]')

    case "$desktop" in
        *gnome*|*xfce*|*cinnamon*|*ukui*|*dde*|*deepin*|*mate*|*budgie*|*pantheon*|*unity*)
            echo "gnome"; return ;;
        *kde*|*plasma*)
            echo "kde"; return ;;
    esac

    if command -v gsettings >/dev/null 2>&1; then
        echo "gnome"; return
    fi
    if command -v kwriteconfig6 >/dev/null 2>&1 || command -v kwriteconfig5 >/dev/null 2>&1; then
        echo "kde"; return
    fi
    echo "unsupported"
}

if [ "$#" -lt 1 ]; then
    echo "Usage: $0 <mode> [proxy_ip proxy_port ignore_hosts]" >&2
    exit 1
fi

MODE=$1
PROXY_IP=${2:-}
PROXY_PORT=${3:-}
IGNORE_HOSTS=${4:-}

if ! [[ "$MODE" =~ ^(manual|none)$ ]]; then
    echo "Invalid mode. Use 'none' or 'manual'." >&2
    exit 1
fi

if [ "$MODE" = "manual" ] && { [ -z "$PROXY_IP" ] || [ -z "$PROXY_PORT" ]; }; then
    echo "manual mode requires proxy_ip and proxy_port" >&2
    exit 1
fi

DE=$(detect_desktop_environment)
echo "Detected DE family: $DE"

if [ "$DE" = "gnome" ]; then
    set_gnome_proxy "$MODE" "$PROXY_IP" "$PROXY_PORT" "$IGNORE_HOSTS"
elif [ "$DE" = "kde" ]; then
    # v2rayN applies both for KDE (many apps still honor gsettings)
    if command -v gsettings >/dev/null 2>&1; then
        set_gnome_proxy "$MODE" "$PROXY_IP" "$PROXY_PORT" "$IGNORE_HOSTS"
    fi
    set_kde_proxy "$MODE" "$PROXY_IP" "$PROXY_PORT" "$IGNORE_HOSTS"
else
    echo "Unsupported desktop environment for system proxy." >&2
    exit 1
fi
