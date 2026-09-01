# Direction B Controller Repair

Lane state: stopped after completed concept output; the Qwen runner exceeded its shell limit during finalization. A same-model repair attempt also stopped without writing.

Controller normalization before publication:

- Browser review found the mobile `.tabbar` fixed against the blurred sticky `.topbar` rather than the iframe viewport.
- The controller disabled `backdrop-filter` on `.topbar` below 760px and made its background opaque. No hierarchy, styling direction, content, interaction, or desktop behavior changed.
- Required re-verification: mobile header/theme visibility, nav bottom equal to viewport bottom, unobscured main content, no horizontal overflow, and unchanged desktop navigation.

This repair is disclosed separately because it was not authored by the original comparison lane.
