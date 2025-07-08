// TODO re-enable when `graphology` supports ESM `exports` and `.js` import/export syntax
// import {} from 'graphology'
import * as graphology_ from 'graphology'
import type * as graphologyTypes from 'graphology-types'

export const graphology = graphology_ as any

export declare class IGraph<
  NodeAttributes extends graphologyTypes.Attributes = graphologyTypes.Attributes,
  EdgeAttributes extends graphologyTypes.Attributes = graphologyTypes.Attributes,
  GraphAttributes extends graphologyTypes.Attributes = graphologyTypes.Attributes,
> extends graphologyTypes.AbstractGraph<NodeAttributes, EdgeAttributes, GraphAttributes> {
  constructor(options?: graphologyTypes.GraphOptions)
}

export const DirectedGraph = class DirectedGraph extends graphology.DirectedGraph {} as typeof IGraph

export const Graph = class Graph extends graphology.Graph {} as typeof IGraph

// export const graphology = graphology_ as graphologyTypes

/*

Example usage:

const dag = new graphology.DirectedGraph({ allowSelfLoops: false })

nodes.forEach((node) => dag.addNode(node.id, { width: node.data.label.length * 100, height: 40 }))
edges.forEach((edge) => {
	// TODO do this filtering earlier
	if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) return

	dag.addEdge(edge.source, edge.target)
})

graphologyLayout.random.assign(dag) // needed for initial `x`, `y` values
const sensibleSettings = forceAtlas2.inferSettings(dag)
// forceAtlas2.assign(dag, { iterations: 100, settings: { adjustSizes: true,  } })
forceAtlas2.assign(dag, { iterations: 100, settings: sensibleSettings })

*/
