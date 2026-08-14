import React from 'react'
import { ChevronRight, GitBranch } from 'lucide-react'
import { type BranchChildInfo } from '../../utils/branchDisplay'

interface BranchChildrenListProps {
  branchChildren: BranchChildInfo[]
  onOpenBranch: (sessionId: string) => void
}

export const BranchChildrenList = React.memo<BranchChildrenListProps>(
  ({ branchChildren, onOpenBranch }) => {
    if (branchChildren.length === 0) return null

    return (
      <div className="message-branch-children">
        <div className="message-branch-children-label">
          <GitBranch size={12} />
          <span>派生分支</span>
        </div>
        <div className="message-branch-children-list">
          {branchChildren.map((branch) => (
            <button
              key={branch.sessionId}
              type="button"
              className="message-branch-link"
              onClick={() => onOpenBranch(branch.sessionId)}
              title={`打开分支：${branch.title}`}
            >
              <span className="message-branch-link-title">{branch.title}</span>
              <span className="message-branch-link-meta">
                {branch.messageCount} msg{branch.messageCount === 1 ? '' : 's'}
                {branch.shortRunId ? ` · run ${branch.shortRunId}` : ''}
              </span>
              <ChevronRight size={12} />
            </button>
          ))}
        </div>
      </div>
    )
  },
  (prev, next) => {
    if (prev.branchChildren.length !== next.branchChildren.length) return false
    for (let i = 0; i < prev.branchChildren.length; i += 1) {
      if (
        prev.branchChildren[i].sessionId !== next.branchChildren[i].sessionId ||
        prev.branchChildren[i].title !== next.branchChildren[i].title ||
        prev.branchChildren[i].messageCount !== next.branchChildren[i].messageCount ||
        prev.branchChildren[i].shortRunId !== next.branchChildren[i].shortRunId
      ) {
        return false
      }
    }
    return true
  }
)

BranchChildrenList.displayName = 'BranchChildrenList'
