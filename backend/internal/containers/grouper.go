package containers

import (
	"sort"

	"github.com/dockedapp/backend/internal/domain"
)

const unstackedName = "Unstacked"

// groupByStack groups containers into stacks by their stack name.
// Named stacks are sorted alphabetically; unstacked containers always appear last.
func groupByStack(containers []domain.Container) []domain.Stack {
	order := []string{}
	groups := map[string][]domain.Container{}

	for _, container := range containers {
		name := unstackedName
		if container.StackName != nil && *container.StackName != "" {
			name = *container.StackName
		}

		if _, exists := groups[name]; !exists {
			order = append(order, name)
		}
		groups[name] = append(groups[name], container)
	}

	// Sort named stacks alphabetically, keeping "Unstacked" last.
	sort.Slice(order, func(i, j int) bool {
		if order[i] == unstackedName {
			return false
		}
		if order[j] == unstackedName {
			return true
		}
		return order[i] < order[j]
	})

	stacks := make([]domain.Stack, 0, len(order))
	for _, name := range order {
		stackContainers := groups[name]
		stack := domain.Stack{
			Name:       name,
			Containers: stackContainers,
			TotalCount: len(stackContainers),
		}
		for _, container := range stackContainers {
			if container.HasUpdate {
				stack.UpdateCount++
			} else {
				stack.UptodateCount++
			}
		}
		stacks = append(stacks, stack)
	}

	return stacks
}
