import { createContext, useContext } from 'react';

/* what every dashboard section may use: which panel, go to a section, redraw after a
   change to the demo storage, the product being edited, the customer card that is open */
export const DashContext = createContext(null);
export const useDash = () => useContext(DashContext);
