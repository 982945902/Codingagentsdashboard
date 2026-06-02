import { Agent, Task } from "../App";
import { GripVertical, User, AlertCircle, Clock } from "lucide-react";

interface KanbanBoardProps {
  tasks: Task[];
  agents: Agent[];
  onSelectAgent: (agent: Agent) => void;
}

export function KanbanBoard({ tasks, agents, onSelectAgent }: KanbanBoardProps) {
  const columns: Array<{
    id: Task["status"];
    title: string;
    color: string;
  }> = [
    { id: "backlog", title: "Backlog", color: "bg-gray-500" },
    { id: "in-progress", title: "In Progress", color: "bg-blue-500" },
    { id: "review", title: "Review", color: "bg-yellow-500" },
    { id: "done", title: "Done", color: "bg-green-500" },
  ];

  const getTasksByStatus = (status: Task["status"]) => {
    return tasks.filter((task) => task.status === status);
  };

  const getAgentById = (id: string | null) => {
    if (!id) return null;
    return agents.find((agent) => agent.id === id);
  };

  const getPriorityColor = (priority: Task["priority"]) => {
    switch (priority) {
      case "high":
        return "text-red-600 dark:text-red-400";
      case "medium":
        return "text-yellow-600 dark:text-yellow-400";
      case "low":
        return "text-green-600 dark:text-green-400";
    }
  };

  return (
    <div className="size-full overflow-x-auto p-4 bg-[#0d1117]">
      <div className="flex gap-4 h-full min-w-max">
        {columns.map((column) => {
          const columnTasks = getTasksByStatus(column.id);
          return (
            <div key={column.id} className="flex-shrink-0 w-80 flex flex-col">
              {/* Column Header */}
              <div className="flex items-center gap-2 mb-3">
                <div className={`w-1 h-5 ${column.color} rounded-full`} />
                <h3 className="text-[#c9d1d9]">{column.title}</h3>
                <span className="ml-auto px-2 py-0.5 bg-[#21262d] rounded-md text-[#8b949e] border border-[#30363d]">
                  {columnTasks.length}
                </span>
              </div>

              {/* Tasks */}
              <div className="flex-1 space-y-2 overflow-y-auto">
                {columnTasks.map((task) => {
                  const agent = getAgentById(task.assignedTo);
                  return (
                    <div
                      key={task.id}
                      className="bg-[#161b22] border border-[#30363d] rounded-lg p-3 hover:border-[#58a6ff] transition-colors cursor-move group"
                    >
                      {/* Drag Handle */}
                      <div className="flex items-start gap-2 mb-2">
                        <GripVertical className="w-4 h-4 text-[#484f58] opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <div className="text-[#c9d1d9] mb-1">
                            {task.title}
                          </div>
                          <p className="text-[#8b949e] line-clamp-2">
                            {task.description}
                          </p>
                        </div>
                      </div>

                      {/* Task Meta */}
                      <div className="flex items-center justify-between mt-3">
                        <div className="flex items-center gap-2">
                          {agent ? (
                            <button
                              onClick={() => onSelectAgent(agent)}
                              className="flex items-center gap-1.5 px-2 py-1 bg-[#21262d] rounded-md hover:bg-[#30363d] transition-colors border border-[#30363d]"
                            >
                              <div
                                className={`w-2 h-2 rounded-full ${
                                  agent.status === "running"
                                    ? "bg-[#3fb950]"
                                    : agent.status === "error"
                                    ? "bg-[#f85149]"
                                    : "bg-[#6e7681]"
                                }`}
                              />
                              <User className="w-3 h-3 text-[#8b949e]" />
                              <span className="text-[#c9d1d9]">
                                {agent.name.split(" ")[0]}
                              </span>
                            </button>
                          ) : (
                            <div className="flex items-center gap-1.5 text-[#8b949e] px-2 py-1 bg-[#21262d] rounded-md border border-[#30363d]">
                              <User className="w-3 h-3" />
                              <span>Unassigned</span>
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          <span
                            className={`uppercase px-1.5 py-0.5 rounded text-xs ${
                              task.priority === "high"
                                ? "bg-[#f8514933] text-[#ff7b72] border border-[#f8514966]"
                                : task.priority === "medium"
                                ? "bg-[#d2940033] text-[#f0883e] border border-[#d2940066]"
                                : "bg-[#3fb95033] text-[#56d364] border border-[#3fb95066]"
                            }`}
                          >
                            {task.priority}
                          </span>
                        </div>
                      </div>

                      {/* Warning for error status */}
                      {agent?.status === "error" && (
                        <div className="mt-2 flex items-center gap-1.5 text-[#ff7b72] bg-[#f8514933] px-2 py-1 rounded border border-[#f8514966]">
                          <AlertCircle className="w-3 h-3" />
                          <span>Agent error</span>
                        </div>
                      )}
                    </div>
                  );
                })}

                {columnTasks.length === 0 && (
                  <div className="flex items-center justify-center h-32 text-[#8b949e] border-2 border-dashed border-[#30363d] rounded-lg">
                    No tasks
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
