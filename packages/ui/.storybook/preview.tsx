import { withThemeByClassName } from "@storybook/addon-themes"
import type { Preview } from "@storybook/react-vite"
import { TooltipProvider } from "../src/controls/tooltip"
import "./storybook.css"

const preview: Preview = {
  parameters: {
    layout: "padded",
    controls: { expanded: true },
    // The tokens first: everything below is built from them.
    options: { storySort: { order: ["Foundations", "Primitives", "Controls", "Patterns", "Domains", "*"] } },
  },
  decorators: [
    (Story) => (
      <TooltipProvider>
        <div className="bg-page p-4 text-default">
          <Story />
        </div>
      </TooltipProvider>
    ),
    // The app's dark theme is the `.dark` class on <html> (apps/web lib/theme.ts); the toolbar switches it.
    withThemeByClassName({ themes: { light: "", dark: "dark" }, defaultTheme: "light", parentSelector: "html" }),
  ],
}

export default preview
