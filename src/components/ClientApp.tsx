import BatchQueryApp from './BatchQueryApp';
import GlobalErrorBoundary from './GlobalErrorBoundary';

export default function ClientApp() {
  return (
    <GlobalErrorBoundary>
      <BatchQueryApp />
    </GlobalErrorBoundary>
  );
}
