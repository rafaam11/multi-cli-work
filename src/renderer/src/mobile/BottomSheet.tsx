import { useRef, type ReactNode } from "react";
import { useModalFocus } from "./use-modal-focus";

interface BottomSheetProps {
  /** 대화상자 이름(접근성). */
  label: string;
  onClose(): void;
  children: ReactNode;
}

/**
 * 폰 화면 아래에서 올라오는 시트. 자주 쓰지 않는 조작(세션 메뉴·새 세션·호스트 메뉴)을 화면 줄 대신
 * 여기에 둬서 세로 공간을 터미널에 남긴다. 넓은 폭(레일)에서는 가운데 뜬 카드가 된다(phone.css).
 */
export function BottomSheet({ label, onClose, children }: BottomSheetProps) {
  const panel = useRef<HTMLDivElement>(null);
  useModalFocus(panel, onClose);
  return (
    <div className="m-sheet-overlay">
      <button type="button" className="m-sheet-backdrop" aria-label={`${label} 닫기`} tabIndex={-1} onClick={onClose} />
      <div className="m-sheet" role="dialog" aria-modal="true" aria-label={label} ref={panel}>
        <div className="m-sheet-handle" aria-hidden="true" />
        {children}
      </div>
    </div>
  );
}
