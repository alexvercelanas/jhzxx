import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import Home from '@/pages/Home';
import EmbedMovie from '@/pages/EmbedMovie';
import EmbedTV from '@/pages/EmbedTV';
import EmbedAnime from '@/pages/EmbedAnime';
import { Route, Switch, Router as WouterRouter } from 'wouter';

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/movie/:id" component={EmbedMovie} />
      <Route path="/tv/:id/:season/:episode" component={EmbedTV} />
      <Route path="/anime/:id/:episode/:track" component={EmbedAnime} />
      {/* Shorthand routes used by embed sites that omit the /movie/ or /tv/ prefix */}
      <Route path="/:id/:season/:episode" component={EmbedTV} />
      <Route path="/:id" component={EmbedMovie} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
