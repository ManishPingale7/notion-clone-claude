import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { api } from '../api';
import { useApp } from '../store';
import { Modal, Avatar, Spinner, confirmDialog } from '../components/ui';
import { ReadOnlyBlocks } from '../editor/ReadOnlyBlocks';
import { formatDateTime, pageTitle } from '../lib/format';
import type { Block, PageMeta, User } from '../types';

interface Version {
  id: string;
  title: string;
  icon: string | null;
  createdAt: number;
  author: User | null;
}

export function HistoryModal({ pageId, workspaceId, canRestore, onClose, onRestored }: { pageId: string; workspaceId: string; canRestore: boolean; onClose: () => void; onRestored: () => void }) {
  const toast = useApp((s) => s.toast);
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ blocks: Block[]; title: string; icon: string | null; pages: Record<string, PageMeta> } | null>(null);

  useEffect(() => {
    api.get(`/api/pages/${pageId}/history`).then((r) => {
      setVersions(r.versions);
      if (r.versions[0]) setSelected(r.versions[0].id);
    });
  }, [pageId]);

  useEffect(() => {
    if (!selected) return;
    setPreview(null);
    api.get(`/api/pages/${pageId}/history/${selected}`).then((r) => setPreview({ ...r.version, pages: r.pages }));
  }, [selected, pageId]);

  const restore = async () => {
    if (!selected) return;
    if (!(await confirmDialog({ title: 'Restore this version?', body: 'The current page content will be replaced. You can undo this from page history.', confirm: 'Restore' }))) return;
    try {
      await api.post(`/api/pages/${pageId}/history/${selected}/restore`);
      toast('Version restored');
      onRestored();
      onClose();
    } catch (e: any) {
      toast(e.message, { kind: 'error' });
    }
  };

  return (
    <Modal onClose={onClose} width={1040} top="5vh">
      <div className="history-modal" data-testid="history-modal">
        <div className="history-preview">
          {preview ? (
            <div className="history-page">
              <div className="history-title">
                {preview.icon && <span style={{ marginRight: 8 }}>{preview.icon}</span>}
                {pageTitle(preview.title)}
              </div>
              <ReadOnlyBlocks blocks={preview.blocks} pages={preview.pages} pageId={pageId} workspaceId={workspaceId} navigate={() => {}} />
            </div>
          ) : (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 60 }}>{versions && versions.length === 0 ? <span className="faint">No versions yet</span> : <Spinner />}</div>
          )}
        </div>
        <div className="history-side">
          <div className="history-side-head">
            <span>Version history</span>
            <button className="icon-btn" onClick={onClose}>
              <X size={16} />
            </button>
          </div>
          <div className="history-list">
            {versions?.length === 0 && <div className="faint" style={{ padding: 14, fontSize: 13 }}>Versions are saved automatically as you edit (at most every 5 minutes).</div>}
            {versions?.map((v) => (
              <button key={v.id} className={'history-item ' + (v.id === selected ? 'on' : '')} onClick={() => setSelected(v.id)}>
                <div>{formatDateTime(v.createdAt)}</div>
                {v.author && (
                  <div className="faint small row" style={{ gap: 6, marginTop: 2 }}>
                    <Avatar user={v.author} size={16} /> {v.author.name}
                  </div>
                )}
              </button>
            ))}
          </div>
          <div className="history-foot">
            <button className="btn btn-primary btn-block" disabled={!selected || !canRestore} onClick={restore} data-testid="restore-version">
              Restore version
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
