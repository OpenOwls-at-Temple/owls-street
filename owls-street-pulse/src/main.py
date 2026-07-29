import os
import sys
import time
import argparse
import signal
import logging
from logging.handlers import RotatingFileHandler
from datetime import datetime, timezone
import uvicorn
from src.web import app

from src.config import load_config
from src.engine import AlertEngine

# Flag to control daemon running state
keep_running = True

def handle_shutdown_signal(signum, frame):
    """Gracefully handles SIGINT (Ctrl+C) and SIGTERM."""
    global keep_running
    logger = logging.getLogger(__name__)
    logger.info("Shutdown signal received. Wrapping up current tasks and exiting...")
    keep_running = False

class _ErrorCounter(logging.Handler):
    """Counts ERROR-and-above records so one-off runs can report a non-zero exit status."""

    def __init__(self):
        super().__init__(level=logging.ERROR)
        self.count = 0

    def emit(self, record):
        self.count += 1


def setup_logging(log_dir: str = "logs"):
    """Configures system-wide logging with both Console and Rotating File outputs."""
    os.makedirs(log_dir, exist_ok=True)
    log_file = os.path.join(log_dir, "app.log")

    formatter = logging.Formatter(
        fmt="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S"
    )

    # Console Handler
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setFormatter(formatter)
    console_handler.setLevel(logging.INFO)

    # Rotating File Handler (10MB files, max 5 backup copies)
    file_handler = RotatingFileHandler(log_file, maxBytes=10 * 1024 * 1024, backupCount=5)
    file_handler.setFormatter(formatter)
    file_handler.setLevel(logging.INFO)

    # Root Logger Config
    root_logger = logging.getLogger()
    root_logger.setLevel(logging.INFO)
    root_logger.addHandler(console_handler)
    root_logger.addHandler(file_handler)

    # Suppress verbose logs from external requests library
    logging.getLogger("urllib3").setLevel(logging.WARNING)

def main():
    # Register termination signals
    signal.signal(signal.SIGINT, handle_shutdown_signal)
    signal.signal(signal.SIGTERM, handle_shutdown_signal)

    # Parse arguments
    parser = argparse.ArgumentParser(description="Owls Street Pulse Alert System")
    parser.add_argument(
        "--config",
        default="config/config.yaml",
        help="Path to the YAML configuration file (default: config/config.yaml)"
    )
    parser.add_argument(
        "--db",
        default="data/alerts.db",
        help="Path to the SQLite database file (default: data/alerts.db)"
    )
    parser.add_argument(
        "--once",
        action="store_true",
        help="Run indicator checks once and exit (useful for cron jobs)"
    )
    parser.add_argument(
        "--host",
        default="0.0.0.0",
        help="Dashboard server bind host (default: 0.0.0.0)"
    )
    parser.add_argument(
        "--port",
        type=int,
        default=8000,
        help="Dashboard server bind port (default: 8000)"
    )
    args = parser.parse_args()

    # Set up logs before doing anything else
    setup_logging()
    logger = logging.getLogger("owls-street-pulse")

    logger.info("Initializing Owls Street Pulse Alert System...")

    # Guide user if configuration file is missing
    if not os.path.exists(args.config):
        example_config = args.config + ".example"
        logger.error(f"Configuration file '{args.config}' not found.")
        if os.path.exists(example_config):
            logger.info(f"Please copy '{example_config}' to '{args.config}' and fill in your credentials.")
        sys.exit(1)

    # Execution Modes
    if args.once:
        logger.info("Running alert checks in ONE-OFF mode...")
        # Load and validate configuration
        try:
            config = load_config(args.config)
            logger.info(f"Successfully loaded configuration from '{args.config}'.")
        except Exception as e:
            logger.error(f"Configuration validation failed: {e}")
            sys.exit(1)

        # Initialize execution engine
        try:
            engine = AlertEngine(config=config, db_path=args.db)
            logger.info(f"Alert State Database initialized at '{args.db}'.")
        except Exception as e:
            logger.error(f"Failed to initialize Alert Engine: {e}")
            sys.exit(1)

        # run_checks() handles per-symbol failures internally and returns normally, so a
        # cycle where every fetch 401'd used to exit 0. In daemon mode that is right — the
        # next tick retries — but a scheduled one-off run reporting success while silently
        # delivering nothing is the failure you most need to see. Count logged errors and
        # exit non-zero so the caller (cron, CI) surfaces it.
        error_counter = _ErrorCounter()
        logging.getLogger().addHandler(error_counter)
        try:
            engine.run_checks()
        except Exception as e:
            logger.error(f"Error during checks: {e}")
            sys.exit(1)
        finally:
            logging.getLogger().removeHandler(error_counter)

        if error_counter.count:
            logger.error(
                f"One-off checks completed with {error_counter.count} error(s) — "
                "some rules were not evaluated."
            )
            sys.exit(1)
        logger.info("One-off checks complete. Exiting.")
    else:
        logger.info(f"Starting dashboard server at http://{args.host}:{args.port}...")
        
        # Inject paths into env for the web server to pick them up
        os.environ["WEB_CONFIG_PATH"] = args.config
        os.environ["WEB_DB_PATH"] = args.db
        
        try:
            uvicorn.run("src.web:app", host=args.host, port=args.port, log_level="info")
        except Exception as e:
            logger.error(f"Failed to start dashboard server: {e}")
            sys.exit(1)

if __name__ == "__main__":
    main()

