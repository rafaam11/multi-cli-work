import { useState } from "react";

/** Inline rename field shared by every surface that shows a session name. */
export function SessionNameInput({
  initialName,
  onSubmit,
  onCancel,
}: {
  initialName: string;
  onSubmit(name: string | null): void;
  onCancel(): void;
}) {
  const [value, setValue] = useState(initialName);
  return (
    <form
      className="session-rename"
      aria-label="세션 이름 변경"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(value.trim() === "" ? null : value.trim());
      }}
    >
      <input
        type="text"
        aria-label="세션 이름"
        value={value}
        autoFocus
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            onCancel();
          }
        }}
        onBlur={onCancel}
      />
    </form>
  );
}
