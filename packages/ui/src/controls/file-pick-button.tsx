import * as React from "react"
import { Button, type ButtonProps } from "./button"

/**
 * A button that opens the system's file picker: the files picked (`accept` narrows them, `multiple` allows several) go to
 * `onFiles`. The same file can be picked again right after (the picker forgets it each time).
 */
export const FilePickButton = React.forwardRef<HTMLButtonElement, Omit<ButtonProps, "onClick" | "type" | "className"> & { accept?: string; multiple?: boolean; onFiles: (files: File[]) => void }>(
  function FilePickButton({ accept, multiple, onFiles, ...props }, ref) {
    const input = React.useRef<HTMLInputElement>(null)
    return (
      <>
        <Button ref={ref} type="button" {...props} onClick={() => input.current?.click()} />
        <input
          ref={input}
          type="file"
          accept={accept}
          multiple={multiple}
          hidden
          tabIndex={-1}
          onChange={(event) => {
            const files = [...(event.currentTarget.files ?? [])]
            event.currentTarget.value = ""
            if (files.length) onFiles(files)
          }}
        />
      </>
    )
  },
)
