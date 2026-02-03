---
"@herdctl/core": patch
---

Fix Discord typing indicator to stop immediately when messages are sent

The typing indicator now stops as soon as the first message is sent, rather than continuing to show "typing..." while messages are being delivered. This provides a more natural chat experience.

**Improvements**:
- Stop typing immediately after SDK execution completes
- Stop typing when the first streamed message is sent
- Prevent multiple stopTyping calls with state tracking
- Proper cleanup in finally block for error cases
- Removed verbose debug logging for cleaner output
