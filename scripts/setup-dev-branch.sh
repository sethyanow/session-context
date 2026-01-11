#!/bin/bash
# Setup script for creating the dev branch
# Run this after merging the PR to set up the development workflow

set -e

echo "🚀 Setting up dev branch..."

# Check if dev branch already exists locally
if git show-ref --verify --quiet refs/heads/dev; then
    echo "✅ Dev branch already exists locally"
    git checkout dev
    
    # Check if it exists remotely
    if git ls-remote --exit-code --heads origin dev >/dev/null 2>&1; then
        echo "✅ Dev branch already exists on remote. Pulling latest changes..."
        git pull origin dev
    else
        echo "⬆️  Pushing existing local dev branch to GitHub..."
        git push -u origin dev
    fi
    
    echo "✅ Dev branch setup complete!"
    exit 0
fi

# Check if dev branch exists remotely but not locally
if git ls-remote --exit-code --heads origin dev >/dev/null 2>&1; then
    echo "📥 Dev branch exists on remote. Checking it out..."
    git fetch origin dev
    git checkout -b dev origin/dev
    echo "✅ Dev branch setup complete!"
    exit 0
fi

# Check if we're on main
current_branch=$(git rev-parse --abbrev-ref HEAD)
if [ "$current_branch" != "main" ]; then
    echo "⚠️  Warning: You're not on the main branch. Current branch: $current_branch"
    read -p "Do you want to continue? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Create dev branch
echo "📌 Creating dev branch from current commit..."
git checkout -b dev

# Push dev branch to origin
echo "⬆️  Pushing dev branch to GitHub..."
git push -u origin dev

echo "✅ Dev branch created and pushed successfully!"
echo ""
echo "Next steps:"
echo "1. Go to GitHub Settings > Branches"
echo "2. Add branch protection rules for 'main' and 'dev' branches"
echo "3. See DEVELOPMENT.md for recommended protection rules"
echo ""
echo "Branch structure:"
echo "  main - Production releases (protected)"
echo "  dev  - Development integration (protected)"
echo "  feature/* - Feature branches (merge to dev)"
