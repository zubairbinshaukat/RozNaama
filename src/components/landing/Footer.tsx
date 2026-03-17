import { motion } from "framer-motion";

const PortfolioURL = "https://www.google.com/search?q=zubair+bin+shaukat";

export default function Footer() {
  return (
    <footer className="border-t border-border/50">
      <div className="mx-auto px-4 sm:px-6 py-8 sm:py-10 max-w-[1300px]">
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.1, duration: 0.6 }}
          className="flex flex-col sm:flex-row items-center sm:justify-between gap-4 sm:gap-0"
        >

          {/* Credit card — top on mobile, left on desktop */}
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2, duration: 0.6 }}
          >
            <a
              href="https://github.com/ZubairBinShaukat"
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center gap-3 px-4 sm:px-5 py-2.5 sm:py-3 rounded-full transition-all duration-300 bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10"
            >
              <div className="relative shrink-0">
                <img
                  src="https://avatars.githubusercontent.com/u/145450776?v=4"
                  alt="Zubair Bin Shaukat"
                  className="w-9 h-9 sm:w-11 sm:h-11 rounded-full object-cover ring-2 ring-primary transition-all duration-300 group-hover:scale-105"
                />
                <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 sm:w-3.5 sm:h-3.5 rounded-full border-2 border-background bg-emerald-500" />
              </div>
              <div className="text-left">
                <p className="text-[9px] sm:text-[10px] text-muted-foreground font-semibold uppercase tracking-widest">
                  Built by
                </p>
                <p className="text-sm sm:text-base font-extrabold text-foreground leading-tight group-hover:text-primary transition-colors duration-300">
                  Zubair Bin Shaukat
                </p>
              </div>
              <svg
                className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-muted-foreground opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-300 ml-1 shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
                aria-hidden
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
                />
              </svg>
            </a>
          </motion.div>

          {/* GitHub button — bottom on mobile, right on desktop */}
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.3, duration: 0.6 }}
          >
            <a
              href={PortfolioURL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="View on GitHub"
              className="flex items-center gap-2 px-4 py-2.5 rounded-full border border-border text-sm text-muted-foreground hover:text-foreground hover:border-foreground/30 hover:bg-black/5 dark:hover:bg-white/5 transition-all duration-300 active:scale-95"
            >
              <svg
                viewBox="0 0 24 24"
                width="15"
                height="15"
                fill="currentColor"
                aria-hidden
              >
                <path d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
              </svg>
              Open Source
            </a>
          </motion.div>

        </motion.div>
      </div>
    </footer>
  );
}