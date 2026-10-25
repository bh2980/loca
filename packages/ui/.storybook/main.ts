import type { StorybookConfig } from "@storybook/react-vite"
import tailwindcss from "@tailwindcss/vite"

// The catalog of @loca/ui: the layout and text primitives, and the presentational parts the screens are built from, in light and dark.
// Dev tooling only: nothing here ships with the app.
const config: StorybookConfig = {
  framework: "@storybook/react-vite",
  stories: ["../src/**/*.stories.tsx"],
  addons: ["@storybook/addon-themes"],
  viteFinal: (vite) => ({ ...vite, plugins: [...(vite.plugins ?? []), tailwindcss()] }),
}

export default config
