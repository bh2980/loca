import { Button } from './components/ui/button';
import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle } from './components/ui/dialog';

export function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className={`workflow-dialog ${wide ? 'wide' : ''}`} showCloseButton={false}>
      <div className="workflow-dialog-heading"><DialogTitle>{title}</DialogTitle><Button aria-label={`${title} 닫기`} onClick={onClose} variant="ghost" size="icon-sm"><X size={18} /></Button></div>
      {children}
    </DialogContent>
  </Dialog>;
}
