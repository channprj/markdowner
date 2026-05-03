import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Alert, AlertTitle, AlertDescription } from '../components/ui/alert';
import { Button } from '../components/ui/button';

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
  errorInfo?: ErrorInfo;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
    this.setState({ errorInfo });
  }

  private handleCopy = () => {
    const { error, errorInfo } = this.state;
    const text = `Error: ${error?.message}\n\nStack Trace:\n${errorInfo?.componentStack}`;
    navigator.clipboard.writeText(text);
  };

  private handleReload = () => {
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-screen w-screen items-center justify-center bg-zinc-50 p-4 dark:bg-zinc-950">
          <div className="w-full max-w-2xl space-y-4">
            <Alert variant="destructive">
              <AlertTitle>Something went wrong</AlertTitle>
              <AlertDescription className="mt-2 space-y-4">
                <p className="text-sm">
                  An unexpected error occurred in the application. You can try reloading or copy the error details for support.
                </p>
                
                <div className="rounded-md bg-zinc-100 p-4 text-xs font-mono dark:bg-zinc-900 overflow-auto max-h-64">
                  <div className="font-semibold text-red-600 dark:text-red-400 mb-2">
                    {this.state.error?.toString()}
                  </div>
                  <pre className="text-zinc-600 dark:text-zinc-400 whitespace-pre-wrap">
                    {this.state.errorInfo?.componentStack}
                  </pre>
                </div>

                <div className="flex gap-2 mt-4">
                  <Button variant="default" onClick={this.handleReload}>
                    Reload Application
                  </Button>
                  <Button variant="outline" onClick={this.handleCopy}>
                    Copy Error Details
                  </Button>
                </div>
              </AlertDescription>
            </Alert>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
