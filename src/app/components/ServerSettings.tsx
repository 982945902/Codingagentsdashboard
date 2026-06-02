import { useState } from "react";
import { X, Server, Key, Lock, Save } from "lucide-react";

interface ServerSettingsProps {
  onClose: () => void;
}

export function ServerSettings({ onClose }: ServerSettingsProps) {
  const [serverUrl, setServerUrl] = useState("https://your-server.com:8080");
  const [apiKey, setApiKey] = useState("");
  const [sshKey, setSshKey] = useState("");
  const [autoConnect, setAutoConnect] = useState(true);

  const handleSave = () => {
    console.log("Saving settings:", { serverUrl, apiKey, sshKey, autoConnect });
    // Save to localStorage or API
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm">
      <div className="fixed inset-y-0 right-0 w-full max-w-md bg-background border-l border-border shadow-lg flex flex-col">
        {/* Header */}
        <div className="h-12 lg:h-14 border-b border-border flex items-center justify-between px-4">
          <h2 className="text-card-foreground">Server Settings</h2>
          <button
            onClick={onClose}
            className="p-2 rounded-md hover:bg-secondary transition-colors text-muted-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {/* Server URL */}
          <div>
            <label className="flex items-center gap-2 text-card-foreground mb-2">
              <Server className="w-4 h-4" />
              Server URL
            </label>
            <input
              type="text"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder="https://your-server.com:8080"
              className="w-full px-3 py-2 bg-input-background text-foreground rounded-md border border-border focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <p className="text-muted-foreground mt-1 text-sm">
              URL of your remote coding agents server
            </p>
          </div>

          {/* API Key */}
          <div>
            <label className="flex items-center gap-2 text-card-foreground mb-2">
              <Key className="w-4 h-4" />
              API Key
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Enter your API key"
              className="w-full px-3 py-2 bg-input-background text-foreground rounded-md border border-border focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <p className="text-muted-foreground mt-1 text-sm">
              Authentication key for server access
            </p>
          </div>

          {/* SSH Key */}
          <div>
            <label className="flex items-center gap-2 text-card-foreground mb-2">
              <Lock className="w-4 h-4" />
              SSH Key (Optional)
            </label>
            <textarea
              value={sshKey}
              onChange={(e) => setSshKey(e.target.value)}
              placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
              rows={4}
              className="w-full px-3 py-2 bg-input-background text-foreground rounded-md border border-border focus:outline-none focus:ring-2 focus:ring-ring font-mono resize-none text-sm"
            />
            <p className="text-muted-foreground mt-1 text-sm">
              SSH private key for secure connection
            </p>
          </div>

          {/* Auto Connect */}
          <div className="flex items-center justify-between p-3 bg-card rounded-lg border border-border">
            <div>
              <div className="text-card-foreground">Auto Connect</div>
              <p className="text-muted-foreground text-sm">
                Connect to server on app start
              </p>
            </div>
            <button
              onClick={() => setAutoConnect(!autoConnect)}
              className={`relative w-11 h-6 rounded-full transition-colors ${
                autoConnect ? "bg-primary" : "bg-switch-background"
              }`}
            >
              <div
                className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-sm transition-transform ${
                  autoConnect ? "translate-x-5.5" : "translate-x-0.5"
                }`}
              />
            </button>
          </div>

          {/* Connection Status */}
          <div className="p-4 bg-card rounded-lg border border-border">
            <div className="text-muted-foreground mb-2">Connection Status</div>
            <div className="flex items-center gap-2 text-card-foreground">
              <div className="w-2 h-2 rounded-full bg-status-stopped" />
              <span>Not connected</span>
            </div>
            <button className="mt-3 w-full px-4 py-2 bg-secondary hover:bg-accent rounded-md transition-colors text-secondary-foreground border border-border">
              Test Connection
            </button>
          </div>

          {/* Info */}
          <div className="p-4 bg-primary/10 border border-primary/20 rounded-lg">
            <div className="text-primary mb-1">
              Setup Instructions
            </div>
            <ol className="text-foreground/80 list-decimal list-inside space-y-1 text-sm">
              <li>Deploy agents on your server</li>
              <li>Get API key from server dashboard</li>
              <li>Enter server URL and API key above</li>
              <li>Click "Test Connection" to verify</li>
            </ol>
          </div>
        </div>

        {/* Footer */}
        <div className="h-16 border-t border-border flex items-center justify-end gap-2 px-4">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-md hover:bg-secondary transition-colors text-foreground"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:opacity-90 transition-opacity"
          >
            <Save className="w-4 h-4" />
            Save Settings
          </button>
        </div>
      </div>
    </div>
  );
}
