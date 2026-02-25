#!/bin/bash
# Mock herdctl start output for VHS recording
# Simulates a real fleet boot sequence with realistic timing

sleep 0.3

# Banner (gradient: light blue → herdctl blue → deep navy)
echo ""
printf '\033[38;2;165;216;255m                ▃▃▂                               ▗▃▃                  ▃▃▃                \033[0m\n'
printf '\033[38;2;130;195;255m                ██▊                               ▐█▉            ▐▇▇   ██▊                \033[0m\n'
printf '\033[38;2;95;172;248m                ██▊▃▅▅▅▃    ▃▅▅▅▅▃   ▄▄▖▃▅▅  ▂▄▅▅▃▐█▉   ▂▄▅▅▅▃  ▄▟██▄▖ ██▊                \033[0m\n'
printf '\033[38;2;70;148;240m                ███▛▀▀██▊  ▟█▛▀▀▜█▙  ████▛▊ ▟██▀▀▜██▉  ▟██▀▀▜██▖▀▜██▀▘ ██▊                \033[0m\n'
printf '\033[38;2;50;108;229m                ██▊   ▜█▉ ▐██▄▄▄▄██▌ ██▊   ▐██▎   ▜█▉ ▕██▍   ▀▀▘ ▐██   ██▊                \033[0m\n'
printf '\033[38;2;40;88;200m                ██▊   ▐█▉ ▐██▀▀▀▀▀▀▘ ██▋   ▐██▎   ▐█▉ ▐██▎   ▂▂  ▐██   ██▊                \033[0m\n'
printf '\033[38;2;32;70;175m                ██▊   ▐█▉ ▝██▙▃▃▟██▘ ██▋    ▜██▄▃▅██▉  ▜██▄▃▟██  ▐██▃▖ ██▊                \033[0m\n'
printf '\033[38;2;25;55;145m                ▀▀▘   ▝▀▀   ▀▀▜▛▀▀   ▀▀▘     ▀▀█▀▀▝▀▀   ▀▀▜▛▀▀    ▀▀▀▘ ▀▀▘                \033[0m\n'
echo ""

sleep 0.4
echo "Starting fleet..."
sleep 0.6

printf '\033[32mINFO \033[0m \033[36m[web:chat]\033[0m Web chat manager initialized with 7 agent(s)\n'
sleep 0.2
sleep 0.3
printf '\033[32mINFO \033[0m \033[38;2;74;222;128m[web]\033[0m Web dashboard available at \033[4mhttp://localhost:3232\033[0m\n'
sleep 0.8

printf '\033[32mINFO \033[0m \033[32m[fleet-manager]\033[0m \033[38;2;54;197;240m[slack:personal.homelab]\033[0m Connected to Slack\n'
sleep 0.2
sleep 0.3

printf '\033[32mINFO \033[0m \033[32m[fleet-manager]\033[0m \033[38;2;88;101;242m[discord:herdctl.security-auditor]\033[0m Connected to Discord\n'
sleep 0.3
printf '\033[32mINFO \033[0m \033[32m[fleet-manager]\033[0m \033[38;2;88;101;242m[discord:personal.homelab]\033[0m Connected to Discord\n'
sleep 0.2
printf '\033[32mINFO \033[0m \033[32m[fleet-manager]\033[0m \033[38;2;88;101;242m[discord:personal.JARVIS]\033[0m Connected to Discord\n'
sleep 0.2
sleep 0.1

sleep 0.3

echo ""
echo "Fleet Status"
echo "============"
echo "State: running"
echo "Agents: 7"
echo "Schedules: 7"
echo "Started: 2/25/2026, 9:58:31 AM"
echo ""
echo "Agent Hierarchy:"
echo "  personal/"
echo "    - homelab"
echo "    - JARVIS"
echo "    - garden"
echo "  herdctl/"
echo "    - security-auditor"
echo "    - docs-auditor"
echo "    - changelog-updater"
echo "    - engineer"
echo ""
echo "Press Ctrl+C to stop the fleet"

# Keep alive longer than VHS records so no shell prompt appears
sleep 30
