# Local DNS Setup with dnsmasq in Proxmox

This guide explains how to deploy a DNS service using `dnsmasq` inside a Proxmox LXC container and configure DNS propagation across your virtual environment. It assumes a basic Proxmox setup and familiarity with Linux command line operations.

## 1. Create the LXC Container

1. In the Proxmox web UI, create a new LXC container based on **Ubuntu 24.04**.
2. Assign a static IP, e.g. `192.168.0.250/24`, on bridge `vmbr0` with gateway `192.168.0.1`.
3. Allocate CPU, memory, and disk resources according to your environment. For a lightweight DNS server, **1 vCPU**, **1–2 GB RAM**, and **4–8 GB disk** are usually sufficient.
4. Complete the creation process and start the container.

## 2. Install and Configure `dnsmasq`

Inside the container, run:

```bash
apt update
apt install -y dnsmasq
```

Edit `/etc/dnsmasq.conf` with the following settings:

```bash
# Upstream DNS servers
server=1.1.1.1
server=8.8.8.8

# Local domain
local=/local/

# Static host entries
address=/proxmox.local/192.168.0.100
address=/llm.local/192.168.0.101
```

Enable the service on boot:

```bash
systemctl enable --now dnsmasq
```

Test resolution within the container:

```bash
dig proxmox.local
```

A valid response confirms `dnsmasq` is working.

## 3. Configure the Proxmox Host

Edit `/etc/resolv.conf` to point to the new DNS server and include a fallback server:

```bash
nameserver 192.168.0.250
nameserver 1.1.1.1
```

Lock the file to prevent changes by DHCP or network services:

```bash
chattr +i /etc/resolv.conf
```

## 4. Configure Ubuntu LXC Containers

For each container:

1. Overwrite `/etc/resolv.conf` with your DNS settings:

   ```bash
   echo -e "nameserver 192.168.0.250\nnameserver 1.1.1.1" > /etc/resolv.conf
   ```

2. Lock the file:

   ```bash
   chattr +i /etc/resolv.conf
   ```

When creating containers via `pct create`, you can automate this by adding a post-creation hook script that writes and locks `/etc/resolv.conf`.

## 5. Configure Ubuntu Server VMs with Netplan

For VMs using Netplan, edit `/etc/netplan/01-netcfg.yaml`:

```yaml
network:
  version: 2
  ethernets:
    ens18:
      dhcp4: no
      addresses: [192.168.0.10/24]
      routes:
        - to: 0.0.0.0/0
          via: 192.168.0.1
      nameservers:
        addresses: [192.168.0.250, 1.1.1.1]
```

Fix permissions and apply:

```bash
chmod 600 /etc/netplan/01-netcfg.yaml
netplan apply
```

## 6. Disable systemd-resolved Where Needed

Some containers or VMs may use `systemd-resolved`. Disable it to avoid conflicts:

```bash
systemctl stop systemd-resolved
systemctl disable systemd-resolved
rm /etc/resolv.conf
ln -s /run/systemd/resolve/resolv.conf /etc/resolv.conf
```

Then overwrite `/etc/resolv.conf` with your DNS settings and lock the file as described earlier.

## 7. Tailscale DNS Overrides

If you use Tailscale and it overrides DNS, disable the automatic DNS setting:

```bash
tailscale up --accept-dns=false
```

This restores manual control of `/etc/resolv.conf`.

## 8. Test DNS Resolution

Verify from all systems:

```bash
ping proxmox.local
ping google.com

dig llm.local
```

Successful responses confirm both local and external DNS resolution. If the primary DNS is unreachable, the fallback server (e.g., `1.1.1.1`) ensures continuity.

## 9. LAN-wide DNS via Router DHCP Override (Optional)

To propagate the new DNS server to your entire LAN, configure your router's DHCP settings to use `192.168.0.250` as the primary DNS and `1.1.1.1` as secondary. Dynamic devices will then resolve through `dnsmasq` while still having an external fallback.

## 10. Summary Table

| System     | DNS Configuration                           |
|------------|----------------------------------------------|
| Proxmox    | `/etc/resolv.conf` pointing to `192.168.0.250` with fallback |
| Ubuntu LXC | Manual `/etc/resolv.conf`, locked with `chattr +i` |
| Ubuntu VM  | Netplan configuration with nameservers list |
| LAN        | Router DHCP assigns `192.168.0.250` primary, `1.1.1.1` fallback |

## 11. Future Improvements

- Integrate Pi-hole for ad blocking and analytics.
- Enable DNS-over-TLS for encrypted queries.
- Build a Docker-based version for portability.
- Configure reverse DNS zones for internal IPs.

This setup provides a reliable local DNS service for your virtualized homelab, ensuring consistent name resolution across containers, VMs, and network devices.
