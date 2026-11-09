import { getBezierPath, type EdgeProps, type EdgeTypes } from '@xyflow/react'
import { memo } from 'react'
import { combPath, type FlowEdge as FlowEdgeType } from './layout.ts'

/** A ligação pai → filho. Enquanto o filho roda, pontos correm por ela. */
const FlowEdge = memo(function FlowEdge(props: EdgeProps<FlowEdgeType>) {
  const route = props.data?.route
  const path = route
    ? combPath(props.sourceX, props.sourceY, props.targetX, props.targetY, route)
    : getBezierPath({
        sourceX: props.sourceX,
        sourceY: props.sourceY,
        sourcePosition: props.sourcePosition,
        targetX: props.targetX,
        targetY: props.targetY,
        targetPosition: props.targetPosition,
      })[0]
  const status = props.data?.status ?? 'done'
  return (
    <g className={`fluxo is-${status}`}>
      <path d={path} className="react-flow__edge-path ligacao" fill="none" />
      {status === 'running' && (
        <g className="fluxo-pulso" aria-hidden>
          <circle r="3.5">
            <animateMotion dur="1.6s" repeatCount="indefinite" path={path} />
          </circle>
          <circle r="3.5">
            <animateMotion dur="1.6s" begin="0.8s" repeatCount="indefinite" path={path} />
          </circle>
        </g>
      )}
    </g>
  )
})

export const edgeTypes: EdgeTypes = { flow: FlowEdge }
