import os
import sys
import argparse
import logging
from logging.handlers import RotatingFileHandler
import uvicorn
from src.web import app

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
    # Parse arguments
    parser = argparse.ArgumentParser(description="Owl Street View Trading Dashboard")
    parser.add_argument(
        "--config",
        default="config/config.yaml",
        help="Path to the YAML configuration file (default: config/config.yaml)"
    )
    parser.add_argument(
        "--host",
        default="0.0.0.0",
        help="Dashboard server bind host (default: 0.0.0.0)"
    )
    parser.add_argument(
        "--port",
        type=int,
        default=8080,
        help="Dashboard server bind port (default: 8080)"
    )
    args = parser.parse_args()

    # Set up logs before doing anything else
    setup_logging()
    logger = logging.getLogger("owls-street-view")

    logger.info("Initializing Owl Street View Trading Dashboard...")

    # Guide user if configuration file is missing
    if not os.path.exists(args.config):
        example_config = args.config + ".example"
        logger.error(f"Configuration file '{args.config}' not found.")
        if os.path.exists(example_config):
            logger.info(f"Please copy '{example_config}' to '{args.config}' and fill in your credentials.")
        else:
            example_config_pulse = "config/config.yaml.example"
            if os.path.exists(example_config_pulse):
                 logger.info(f"Please copy '{example_config_pulse}' to '{args.config}' and fill in your credentials.")
        sys.exit(1)

    # Inject paths into env for the web server to pick them up
    os.environ["WEB_CONFIG_PATH"] = args.config

    logger.info(f"Starting dashboard server at http://{args.host}:{args.port}...")
    
    try:
        uvicorn.run("src.web:app", host=args.host, port=args.port, log_level="info")
    except Exception as e:
        logger.error(f"Failed to start dashboard server: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
