import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {startColorScheme} from './color-scheme';
import {V2MobileApp} from './V2MobileApp';
import '../theme-colors.css';
import './mobile.css';
startColorScheme();
createRoot(document.getElementById('root')!).render(<StrictMode><V2MobileApp/></StrictMode>);
